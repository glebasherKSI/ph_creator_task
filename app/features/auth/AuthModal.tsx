/**
 * Модалка входа в админку (magic link → OTP) и контекст `useAuth()`.
 * `AuthProvider` монтирует модалку один раз; страницы зовут `ensureAuthenticated(domain)`
 * и получают `true`, когда вход выполнен (модалка открывается только если входа нет).
 */
import { ArrowLeft, Check, ExternalLink, Loader2 } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { browser } from "wxt/browser";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearAwaitingMagicLink,
  clearPendingOtpFlow,
  pendingOtpStorageKey,
} from "@/lib/auth/session-store";
import { cn } from "@/lib/utils";

import {
  ADMIN_TAB_OPENED_STATUS,
  AUTH_STEPS,
  type AuthStep,
  type DomainAuthStatus,
  MAGIC_LINK_ACCEPTED_STATUS,
  MAGIC_LINK_SENT_STATUS,
  MAGIC_LOGIN_SUBMITTED_STATUS,
  type StatusLine,
  type StatusTone,
  adminTabUrlFor,
  authenticatedStatusLine,
  emailStepStatus,
  forgetStatusFetchTime,
  initialModalView,
  isAuthenticatedStatus,
  queryDomainAuthStatus,
  sendMagicLink,
  submitMagicLogin,
  submitOtp,
} from "./auth-flow";

// ---------------------------------------------------------------------------
// Контекст
// ---------------------------------------------------------------------------

export interface EnsureAuthOptions {
  /** Подсказка под заголовком модалки (зачем нужен вход). */
  message?: string;
  /** Показать модалку даже при выполненном входе (завершить OTP по клику на индикатор). */
  forcePrompt?: boolean;
}

export interface AuthApi {
  /** `true`, когда вход на домене выполнен; при необходимости открывает модалку и ждёт её. */
  ensureAuthenticated(domain: string, options?: EnsureAuthOptions): Promise<boolean>;
  queryDomainAuthStatus(domain: string, options?: { force?: boolean }): Promise<DomainAuthStatus>;
  isModalOpen: boolean;
  /**
   * Сброс модалки при смене домена: закрывает её и отвечает `false` ожидающим.
   * С `newDomain`, совпадающим с доменом модалки, ничего не делает. Флаги входа в storage не трогает.
   */
  resetForDomainSwitch(newDomain?: string): void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth: компонент должен быть внутри <AuthProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Состояние модалки
// ---------------------------------------------------------------------------

interface ModalSession {
  domain: string;
  message: string;
  step: AuthStep;
  status: StatusLine;
  sentMagicLink: boolean;
  submittedMagicLogin: boolean;
  busy: boolean;
  email: string;
  token: string;
  otp: string;
}

interface PendingAuth {
  domain: string;
  resolvers: Array<(ok: boolean) => void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pendingLine(text: string): StatusLine {
  return { text, tone: "pending", showOpenAdmin: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ModalSession | null>(null);
  const pendingRef = useRef<PendingAuth | null>(null);

  /** Обновить модалку, только если она всё ещё открыта для этого домена. */
  const patchSession = useCallback((domain: string, patch: Partial<ModalSession>) => {
    setSession((prev) => (prev && prev.domain === domain ? { ...prev, ...patch } : prev));
  }, []);

  const finish = useCallback((ok: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setSession(null);
    if (!pending) return;
    void clearAwaitingMagicLink(pending.domain);
    for (const resolve of pending.resolvers) resolve(ok);
  }, []);

  const resetForDomainSwitch = useCallback((newDomain?: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (newDomain != null && String(newDomain).trim() === pending.domain) return;
    pendingRef.current = null;
    setSession(null);
    for (const resolve of pending.resolvers) resolve(false);
  }, []);

  const ensureAuthenticated = useCallback(
    async (domain: string, options: EnsureAuthOptions = {}): Promise<boolean> => {
      const normalizedDomain = String(domain || "").trim();
      if (!normalizedDomain) return false;

      if (pendingRef.current && pendingRef.current.domain !== normalizedDomain) {
        resetForDomainSwitch(normalizedDomain);
      }

      const status = await queryDomainAuthStatus(normalizedDomain, { force: true });
      if (isAuthenticatedStatus(status) && !options.forcePrompt) return true;

      const current = pendingRef.current;
      if (current && current.domain === normalizedDomain) {
        return new Promise<boolean>((resolve) => current.resolvers.push(resolve));
      }

      return new Promise<boolean>((resolve) => {
        const pending: PendingAuth = { domain: normalizedDomain, resolvers: [resolve] };
        pendingRef.current = pending;

        void (async () => {
          if (!status.pendingOtp) {
            await clearPendingOtpFlow(normalizedDomain);
            await clearAwaitingMagicLink(normalizedDomain);
          }
          if (pendingRef.current !== pending) return;

          forgetStatusFetchTime(normalizedDomain);
          const view = initialModalView(normalizedDomain, status, options);
          setSession({
            domain: normalizedDomain,
            message: view.message,
            step: view.step,
            status: view.status,
            sentMagicLink: false,
            submittedMagicLogin: view.submittedMagicLogin,
            busy: false,
            email: view.email,
            token: "",
            otp: "",
          });
        })();
      });
    },
    [resetForDomainSwitch],
  );

  // --- шаги -----------------------------------------------------------------

  const handleSendMagicLink = useCallback(
    async (domain: string, email: string) => {
      patchSession(domain, { busy: true, status: pendingLine("Отправка magic link…") });
      const result = await sendMagicLink(domain, email);
      if (!result.ok) {
        patchSession(domain, {
          busy: false,
          status: { text: result.message, tone: "error", showOpenAdmin: result.showOpenAdmin },
        });
        return;
      }
      patchSession(domain, {
        busy: false,
        sentMagicLink: true,
        step: "magic-link",
        status: MAGIC_LINK_SENT_STATUS,
      });
    },
    [patchSession],
  );

  const handleMagicLogin = useCallback(
    async (domain: string, token: string) => {
      patchSession(domain, { busy: true, status: pendingLine("Подтверждение magic link…") });
      const result = await submitMagicLogin(domain, token);
      if (!result.ok) {
        patchSession(domain, {
          busy: false,
          status: { text: result.message, tone: "error", showOpenAdmin: result.showOpenAdmin },
        });
        return;
      }
      patchSession(domain, {
        busy: false,
        token: "",
        submittedMagicLogin: true,
        step: "otp",
        status: MAGIC_LOGIN_SUBMITTED_STATUS,
      });
    },
    [patchSession],
  );

  const handleVerifyOtp = useCallback(
    async (domain: string, otp: string) => {
      patchSession(domain, { busy: true, status: pendingLine("Проверка OTP…") });
      const result = await submitOtp(domain, otp);
      if (!result.ok) {
        patchSession(domain, {
          busy: false,
          status: { text: result.message, tone: "error", showOpenAdmin: result.showOpenAdmin },
        });
        return;
      }
      if (pendingRef.current?.domain !== domain) return;
      patchSession(domain, {
        busy: false,
        otp: "",
        status: authenticatedStatusLine(result.authStatus.email),
      });
      finish(isAuthenticatedStatus(result.authStatus));
    },
    [patchSession, finish],
  );

  const handleBackToEmail = useCallback(
    async (domain: string) => {
      await clearAwaitingMagicLink(domain);
      patchSession(domain, {
        sentMagicLink: false,
        token: "",
        step: "email",
        status: emailStepStatus(domain),
      });
    },
    [patchSession],
  );

  const handleOpenAdmin = useCallback(
    async (domain: string) => {
      await browser.tabs.create({ url: adminTabUrlFor(domain) });
      patchSession(domain, { status: ADMIN_TAB_OPENED_STATUS });
    },
    [patchSession],
  );

  // Background принял magic link из вкладки (флаг pending OTP в storage) — переходим к OTP.
  const sessionDomain = session?.domain ?? null;
  useEffect(() => {
    if (!sessionDomain) return;
    const key = pendingOtpStorageKey(sessionDomain);
    if (!key) return;

    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local") return;
      const change = changes[key];
      if (!change || !isRecord(change.newValue) || change.newValue.magicLoginOk !== true) return;
      setSession((prev) =>
        prev && prev.domain === sessionDomain && prev.step !== "otp"
          ? {
              ...prev,
              step: "otp",
              submittedMagicLogin: true,
              token: "",
              status: MAGIC_LINK_ACCEPTED_STATUS,
            }
          : prev,
      );
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [sessionDomain]);

  const api = useMemo<AuthApi>(
    () => ({
      ensureAuthenticated,
      queryDomainAuthStatus,
      isModalOpen: session !== null,
      resetForDomainSwitch,
    }),
    [ensureAuthenticated, resetForDomainSwitch, session],
  );

  return (
    <AuthContext.Provider value={api}>
      {children}
      <Dialog
        open={session !== null}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        {session ? (
          <AuthDialogContent
            session={session}
            onChange={(patch) => patchSession(session.domain, patch)}
            onSendMagicLink={() => void handleSendMagicLink(session.domain, session.email)}
            onMagicLogin={() => void handleMagicLogin(session.domain, session.token)}
            onVerifyOtp={() => void handleVerifyOtp(session.domain, session.otp)}
            onBackToEmail={() => void handleBackToEmail(session.domain)}
            onOpenAdmin={() => void handleOpenAdmin(session.domain)}
            onCancel={() => finish(false)}
          />
        ) : null}
      </Dialog>
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Разметка модалки
// ---------------------------------------------------------------------------

interface AuthDialogContentProps {
  session: ModalSession;
  onChange: (patch: Partial<Pick<ModalSession, "email" | "token" | "otp">>) => void;
  onSendMagicLink: () => void;
  onMagicLogin: () => void;
  onVerifyOtp: () => void;
  onBackToEmail: () => void;
  onOpenAdmin: () => void;
  onCancel: () => void;
}

function AuthDialogContent({
  session,
  onChange,
  onSendMagicLink,
  onMagicLogin,
  onVerifyOtp,
  onBackToEmail,
  onOpenAdmin,
  onCancel,
}: AuthDialogContentProps) {
  const { step, busy } = session;

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle>Вход в админку</DialogTitle>
          <Badge variant="neutral">{session.domain}</Badge>
        </div>
        <DialogDescription>{session.message}</DialogDescription>
      </DialogHeader>

      <Stepper step={step} />
      <StatusLineView status={session.status} busy={busy} />

      {step === "email" ? (
        <StepForm onSubmit={onSendMagicLink}>
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            placeholder="user@example.com"
            autoComplete="email"
            spellCheck={false}
            autoFocus
            disabled={busy}
            value={session.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Отправить magic link
          </Button>
        </StepForm>
      ) : null}

      {step === "magic-link" ? (
        <StepForm onSubmit={onMagicLogin}>
          <p className="text-subhead text-muted-foreground">
            Откройте ссылку из письма в браузере (token подставится автоматически) или вставьте
            token вручную.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={onBackToEmail}
          >
            <ArrowLeft />
            Отправить письмо заново
          </Button>
          <Label htmlFor="auth-token">Token (из URL magic link)</Label>
          <Input
            id="auth-token"
            type="text"
            placeholder="-BLvXB5CpiL8jxHJFQks"
            spellCheck={false}
            autoFocus
            disabled={busy}
            value={session.token}
            onChange={(e) => onChange({ token: e.target.value })}
          />
          <Button type="submit" variant="secondary" disabled={busy}>
            Подтвердить magic link
          </Button>
        </StepForm>
      ) : null}

      {step === "otp" ? (
        <StepForm onSubmit={onVerifyOtp}>
          <Label htmlFor="auth-otp">OTP-код из письма</Label>
          <Input
            id="auth-otp"
            type="text"
            inputMode="numeric"
            placeholder="094855"
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
            disabled={busy}
            value={session.otp}
            onChange={(e) => onChange({ otp: e.target.value })}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Подтвердить OTP
          </Button>
        </StepForm>
      ) : null}

      <DialogFooter>
        {session.status.showOpenAdmin ? (
          <Button type="button" variant="outline" onClick={onOpenAdmin}>
            <ExternalLink />
            Открыть админку в браузере
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function StepForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function Stepper({ step }: { step: AuthStep }) {
  const activeIndex = AUTH_STEPS.findIndex((item) => item.step === step);
  return (
    <ol className="flex items-center gap-2" aria-label="Шаги входа">
      {AUTH_STEPS.map((item, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
        return (
          <li
            key={item.step}
            className={cn(
              "flex items-center gap-1.5 text-caption font-medium",
              state === "active" ? "text-foreground" : "text-muted-foreground",
            )}
            aria-current={state === "active" ? "step" : undefined}
          >
            {index > 0 ? <span className="mr-0.5 h-px w-5 bg-border" aria-hidden /> : null}
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                state === "done" && "bg-success text-success-foreground",
                state === "active" && "bg-primary text-primary-foreground",
                state === "todo" && "bg-surface-2 text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3" /> : index + 1}
            </span>
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  idle: "text-muted-foreground",
  pending: "text-foreground",
  error: "text-destructive",
  ok: "text-success",
};

function StatusLineView({ status, busy }: { status: StatusLine; busy: boolean }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-subhead",
        TONE_CLASS[status.tone],
      )}
    >
      {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
      <span>{status.text}</span>
    </p>
  );
}

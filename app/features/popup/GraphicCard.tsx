import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GRAPHIC_DEFAULT_BASE_URL } from "@/lib/graphic-api";

import { graphicHostLabel, graphicUserLabel, isGraphicConnectivityError } from "./labels";
import type { GraphicState } from "./useGraphic";

function SessionView({ state }: { state: GraphicState }) {
  const name = graphicUserLabel(state.status?.user) || "Вход выполнен";
  const host = graphicHostLabel(state.status?.baseUrl);
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-headline text-primary-foreground"
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-headline">{name}</div>
        <div className="truncate font-mono text-caption text-muted-foreground">{host}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void state.logout()}>
        Выйти
      </Button>
    </div>
  );
}

function LoginForm({ state }: { state: GraphicState }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [serverOpened, setServerOpened] = useState(false);
  const [localError, setLocalError] = useState("");
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const knownBaseUrl = state.status?.baseUrl || GRAPHIC_DEFAULT_BASE_URL;
  const effectiveBaseUrl = baseUrl || knownBaseUrl;
  const error = localError || state.error;
  // Сервер недоступен — сразу раскрываем поле с адресом.
  const serverOpen = serverOpened || isGraphicConnectivityError(state.error);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const trimmedLogin = login.trim();
    if (!trimmedLogin || !password) {
      setLocalError("Укажите логин и пароль");
      (trimmedLogin ? passwordRef : loginRef).current?.focus();
      return;
    }
    setLocalError("");
    const ok = await state.login(trimmedLogin, password, effectiveBaseUrl);
    if (ok) setPassword("");
  }

  return (
    <form className="flex flex-col gap-2" noValidate onSubmit={(ev) => void submit(ev)}>
      <div className="flex gap-2">
        <Input
          ref={loginRef}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Логин"
          autoComplete="username"
          spellCheck={false}
          aria-label="Логин или email"
          className="h-9"
        />
        <Input
          ref={passwordRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
          aria-label="Пароль"
          className="h-9"
        />
      </div>
      <details open={serverOpen} onToggle={(e) => setServerOpened(e.currentTarget.open)}>
        <summary className="cursor-pointer select-none text-caption text-muted-foreground">
          Сервер: <span className="font-mono">{graphicHostLabel(effectiveBaseUrl)}</span>
        </summary>
        <Input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={knownBaseUrl}
          spellCheck={false}
          autoComplete="off"
          aria-label="Адрес API Graphic"
          className="mt-2 h-9 font-mono text-subhead"
        />
      </details>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={state.busy}>
        {state.busy ? "Вхожу…" : "Войти"}
      </Button>
    </form>
  );
}

export function GraphicCard({ state }: { state: GraphicState }) {
  const authenticated = Boolean(state.status?.authenticated);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Promo Graphic</CardTitle>
        <Badge variant={authenticated ? "success" : "muted"}>
          {authenticated ? "Подключено" : "Не в сети"}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {state.status == null ? (
          <p className="text-subhead text-muted-foreground">Проверяю сессию…</p>
        ) : authenticated ? (
          <SessionView state={state} />
        ) : (
          <LoginForm state={state} />
        )}
      </CardContent>
    </Card>
  );
}

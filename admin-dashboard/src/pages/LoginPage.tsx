import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { loginAdmin, verifyAdminTotp } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type LoginStep = "credentials" | "totp";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { from?: string } | null)?.from;
  const setSession = useAuthStore((state) => state.setSession);

  const [step, setStep] = useState<LoginStep>("credentials");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => loginAdmin(userId, password),
    onSuccess: (result) => {
      setChallengeToken(result.challengeToken);
      setStep("totp");
      setErrorMessage(null);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyAdminTotp(challengeToken, totpCode),
    onSuccess: (result) => {
      setSession({
        accessToken: result.accessToken,
        adminUserId: result.admin.userId,
        expiresAt: result.expiresAt,
      });
      navigate(fromPath || "/dashboard/documents", { replace: true });
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
    },
  });

  return (
    <div className="min-h-screen grid place-items-center p-8">
      <Card className="w-full max-w-[520px] shadow-xl border-border bg-card/97">
        <CardHeader>
          <p className="m-0 uppercase tracking-[0.08em] text-primary text-xs font-medium">Knowsis</p>
          <CardTitle className="text-xl font-semibold mt-1">Admin Dashboard</CardTitle>
          <CardDescription className="text-muted-foreground">
            Review parsing quality, compare extracted pages with source PDFs, and inspect entity context.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setErrorMessage(null);
                loginMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="userId">Admin user ID</label>
                <Input
                  id="userId"
                  type="text"
                  autoComplete="username"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="password">Password</label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {errorMessage ? <p className="text-destructive text-sm m-0">{errorMessage}</p> : null}

              <Button type="submit" disabled={loginMutation.isPending} className="mt-1">
                {loginMutation.isPending ? "Verifying..." : "Continue"}
              </Button>
            </form>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setErrorMessage(null);
                verifyMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="totp">Authenticator code</label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  placeholder="123456"
                  required
                />
              </div>

              {errorMessage ? <p className="text-destructive text-sm m-0">{errorMessage}</p> : null}

              <div className="flex gap-3 mt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStep("credentials");
                    setChallengeToken("");
                    setTotpCode("");
                  }}
                >
                  Back
                </Button>
                <Button type="submit" disabled={verifyMutation.isPending}>
                  {verifyMutation.isPending ? "Checking..." : "Sign in"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { loginAdmin, verifyAdminTotp } from "../lib/api";
import { useAuthStore } from "../store/authStore";

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
    <div className="login-shell">
      <div className="login-panel">
        <p className="login-kicker">Knowsis Internal</p>
        <h1>Admin Dashboard Access</h1>
        <p className="login-subtext">
          Review parsing quality, compare extracted pages with source PDFs, and inspect entity context.
        </p>

        {step === "credentials" ? (
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              setErrorMessage(null);
              loginMutation.mutate();
            }}
          >
            <label htmlFor="userId">Admin user ID</label>
            <input
              id="userId"
              type="text"
              autoComplete="username"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

            <button type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Verifying..." : "Continue"}
            </button>
          </form>
        ) : (
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              setErrorMessage(null);
              verifyMutation.mutate();
            }}
          >
            <label htmlFor="totp">Authenticator code</label>
            <input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              placeholder="123456"
              required
            />

            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

            <div className="totp-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setStep("credentials");
                  setChallengeToken("");
                  setTotpCode("");
                }}
              >
                Back
              </button>
              <button type="submit" disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? "Checking..." : "Sign in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

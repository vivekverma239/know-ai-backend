import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PlaygroundMember } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatComposer } from "./ChatComposer";
import { ChatMessages } from "./ChatMessages";
import { ChatModeBar } from "./ChatModeBar";
import { ModeSuggestions } from "./ModeSuggestions";
import { buildTransport, MODES, type ChatMode } from "./modeConfig";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_FILE_ANSWER_MODEL,
} from "./availableModels";

function createSessionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Props = { selectedMember: PlaygroundMember; orgId: string };

export function PlaygroundChat({ selectedMember, orgId }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [mode, setMode] = useState<ChatMode>("finAgent");
  const [sessionId, setSessionId] = useState(createSessionId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agentModel, setAgentModel] = useState(DEFAULT_AGENT_MODEL);
  const [fileAnswerModel, setFileAnswerModel] = useState(DEFAULT_FILE_ANSWER_MODEL);

  const transport = useMemo(
    () =>
      buildTransport(mode, {
        accessToken,
        userId: selectedMember.id,
        orgId,
        sessionId,
        extraBody:
          mode === "finAgent"
            ? { model: agentModel, fileAnswerModel }
            : undefined,
      }),
    [
      accessToken,
      selectedMember.id,
      orgId,
      sessionId,
      mode,
      agentModel,
      fileAnswerModel,
    ],
  );

  // Tying `id` to user|org|mode forces a fresh Chat whenever any change.
  // Without this, useChat keeps the old transport on prop change and requests
  // continue carrying the previous user.
  const chatId = `${selectedMember.id}|${orgId}|${mode}`;

  const { messages, sendMessage, status, setMessages, stop, error, regenerate } = useChat({
    id: chatId,
    transport,
    onError: (err) => {
      console.error(
        `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] useChat onError:`,
        err,
        err?.stack,
      );
      setErrorMessage(err?.message ?? "Chat request failed");
    },
    onFinish: (event) => {
      console.log(
        `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] useChat onFinish:`,
        event,
      );
    },
  });

  useEffect(() => {
    if (error) {
      console.error(
        `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] error state:`,
        error,
        error?.stack,
      );
    }
  }, [error]);

  // === DEBUG: log every status / messages change with timestamps ===
  // These logs are load-bearing — keep until streaming stability is confirmed.
  useEffect(() => {
    console.log(
      `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] status=${status} mode=${mode}`,
    );
  }, [status, mode]);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const lastParts = (last?.parts as Array<{ type: string }> | undefined)?.map(
      (p) => p.type,
    );
    console.log(
      `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] messages=${messages.length} lastRole=${last?.role} lastParts=${JSON.stringify(lastParts)}`,
    );
  }, [messages]);
  useEffect(() => {
    return () => {
      console.warn(
        `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] PlaygroundChat UNMOUNT — this will abort the stream`,
      );
    };
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const original = stopRef.current;
    const wrapped = async () => {
      console.warn(
        `[PlaygroundChat ${new Date().toISOString().slice(11, 23)}] stop() CALLED`,
        new Error("stop callsite").stack,
      );
      return original();
    };
    stopRef.current = wrapped;
    return () => {
      stopRef.current = original;
    };
  }, []);

  // Reset chat when user, org, or mode changes.
  // setMessages intentionally omitted — its identity churns mid-stream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable setter usage
  useEffect(() => {
    setSessionId(createSessionId());
    setMessages([]);
    setErrorMessage(null);
  }, [selectedMember.id, orgId, mode]);

  const handleSend = (msg: PromptInputMessage) => {
    setErrorMessage(null);
    // PromptInputMessage shape: { text: string; files: FileUIPart[] }
    // useChat.sendMessage accepts the same shape directly.
    sendMessage(msg);
  };

  const handleSuggestion = (text: string) => {
    setErrorMessage(null);
    sendMessage({ text });
  };

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col">
      <ChatModeBar
        mode={mode}
        onChange={setMode}
        disabled={status === "streaming" || status === "submitted"}
        agentModel={agentModel}
        onAgentModelChange={setAgentModel}
        fileAnswerModel={fileAnswerModel}
        onFileAnswerModelChange={setFileAnswerModel}
      />

      {errorMessage && (
        <div className="px-2 pt-2">
          <Alert variant="destructive" className="flex items-start justify-between gap-2">
            <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </Alert>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Send a message to start chatting in{" "}
            <span className="font-medium">{MODES[mode].label}</span> mode.
          </p>
          <ModeSuggestions mode={mode} onSelect={handleSuggestion} />
        </div>
      ) : (
        <ChatMessages
          messages={messages}
          status={status}
          onRegenerate={() => regenerate()}
        />
      )}

      <ChatComposer
        status={status}
        onSend={handleSend}
        onStop={() => stopRef.current()}
        disabled={!accessToken}
      />
    </div>
  );
}

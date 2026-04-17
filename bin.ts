// import "dotenv/config";

import dotenv from "dotenv";
dotenv.config({
    path: ".env",
});

import { v4 as uuidv4 } from "uuid";
import { enqueueDocumentParse } from "./src/service/file/enqueueDocumentParse";

type ChatStreamTestConfig = {
    apiBaseUrl: string;
    backendToken: string;
    userId: string;
    orgId: string;
    userEmail: string;
    userName: string;
    deepSearch: string;
    prompt: string;
};

function getConfig(): ChatStreamTestConfig {
    const backendToken = process.env.BACKEND_TOKEN;
    if (!backendToken) {
        throw new Error("BACKEND_TOKEN is required");
    }

    return {
        apiBaseUrl: process.env.API_BASE_URL || "http://localhost:3000/api/v1",
        backendToken,
        userId: process.env.TEST_USER_ID || "34128c07-0d5b-47ac-a721-2ba05156abab",
        orgId: process.env.TEST_ORG_ID || "74a99f99-2946-40c5-a5a4-fc7322312748",
        userEmail: process.env.TEST_USER_EMAIL || "test@example.com",
        userName: process.env.TEST_USER_NAME || "Test User",
        deepSearch: process.env.TEST_DEEP_SEARCH || "knowledgeBase",
        prompt: process.env.TEST_CHAT_PROMPT || "What was facebook's revenue in 2024?",
    };
}

function getHeaders(config: ChatStreamTestConfig): HeadersInit {
    return {
        "Content-Type": "application/json",
        "x-user-id": config.userId,
        "x-org-id": config.orgId,
        "x-user-email": config.userEmail,
        "x-user-name": config.userName,
        authorization: `Bearer ${config.backendToken}`,
    };
}

async function createSession(config: ChatStreamTestConfig): Promise<string> {
    const response = await fetch(`${config.apiBaseUrl}/chat-session`, {
        method: "POST",
        headers: getHeaders(config),
        body: JSON.stringify({
            id: uuidv4(),
            title: `chat-stream-test-${Date.now()}`,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to create session: ${response.status} ${body}`);
    }

    const session = (await response.json()) as { id: string };
    return session.id;
}

async function readStream(response: Response): Promise<{ chunkCount: number; payload: string }> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("No response stream reader available");
    }

    const chunks: Uint8Array[] = [];
    let done = false;
    let chunkCount = 0;

    try {
        while (!done) {
            const next = await reader.read();
            done = next.done;

            if (next.value) {
                chunkCount += 1;
                chunks.push(next.value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    return { chunkCount, payload: new TextDecoder().decode(combined) };
}

export async function testChatStreamApi(): Promise<void> {
    const config = getConfig();
    console.log(`API Base URL: ${config.apiBaseUrl}`);
    console.log(`User: ${config.userId}`);
    console.log(`Org: ${config.orgId}`);
    console.log(`Deep Search: ${config.deepSearch}`);

    // const sessionId = await createSession(config);
    const sessionId = "4639bdcb-4692-4c56-9eca-06a5659d8321";
    console.log(`Session created: ${sessionId}`);

    const response = await fetch(`${config.apiBaseUrl}/chat`, {
        method: "POST",
        headers: getHeaders(config),
        body: JSON.stringify({
            sessionId,
            deepSearch: config.deepSearch,
            // messages: [
            //     {
            //         id: uuidv4(),
            //         role: "user",
            //         parts: [{ type: "text", text: config.prompt }],
            //     },
            // ],
            messages: [{ "parts": [{ "type": "text", "text": "test" }], "id": "fchHLpCix1PtMzcR", "role": "user" }]
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Chat stream request failed: ${response.status} ${body}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") && !contentType.includes("text/plain")) {
        console.warn(`Unexpected content-type for stream: ${contentType}`);
    }

    const streamResult = await readStream(response);
    console.log(`Stream received ${streamResult.chunkCount} chunks`);
    console.log(`Stream payload length: ${streamResult.payload.length}`);
    console.log(`Stream preview: ${streamResult.payload.slice(0, 500)}`);
}

async function main(): Promise<void> {
    // const command = process.argv[2];

    // if (command === "test-chat-stream") {
    //     await testChatStreamApi();
    //     return;
    // }

    // console.log("Usage:");
    // console.log("  tsx bin.ts test-chat-stream");


    await enqueueDocumentParse("11ee4f83-81f6-4996-9d58-8d4e2915942b");
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
});

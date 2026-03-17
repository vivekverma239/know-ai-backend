import { type StepMessage, StepType } from "@/@types/agents";
import { logger } from "@/utils/logger";
import { observe } from "@lmnr-ai/lmnr";
import { v4 as uuidv4 } from "uuid";
import { chapterAgentV3 } from "../fileAgent/chapter";

export const processDeepSearchQuery = async ({
  query,
  userId,
  orgId,
  callback,
}: {
  query: string;
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  const queryExpansionStep: StepMessage = {
    id: uuidv4(),
    type: StepType.QUERY_EXPANSION,
    status: "done",
    message: "Query passed to deep search agent",
    metadata: {
      query: query,
    },
  };
  callback?.(queryExpansionStep);

  logger.info("Running chapter agent");

  const responseCall = () =>
    observe(
      { name: "chapterAgentV3" },
      async (query: string, userId: string, orgId: string) =>
        await chapterAgentV3({ query, userId, orgId, callback }),
      query,
      userId,
      orgId,
    );
  const response = await responseCall();

  // log final response
  const finalResponseStep: StepMessage = {
    id: uuidv4(),
    type: StepType.RESPOND,
    status: "done",
    message: "Final response",
    metadata: {
      response: response,
    },
  };
  callback?.(finalResponseStep);

  return {
    response: response,
  };
};

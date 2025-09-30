import { logger } from "./logger";

/**
 * Parses a  text with json schema into an object.
 * it parses the text if it contains ```json and ```
 * @param json - The JSON string to parse.
 * @returns The parsed object.
 */
export const parseJson = (text: string): unknown => {
  const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
  const match = jsonRegex.exec(text);
  if (match) {
    const jsonString = match[1];
    if (jsonString) {
      try {
        // Replace escaped single quotes with regular single quotes
        const cleanedJsonString = jsonString.replace(/\\'/g, "'");
        return JSON.parse(cleanedJsonString);
      } catch (error) {
        logger.error(`Error parsing JSON: ${jsonString}`);
        throw error;
      }
    }
  }
  return null;
};

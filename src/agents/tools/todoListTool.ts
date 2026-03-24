import { tool } from "ai";
import { v4 as uuidv4 } from "uuid"; // Using uuid instead of nanoid to match existing project style if needed, but package.json has uuid. source used nanoid.
import { z } from "zod";
import type { ToolContext } from "./toolContext";
// Checking package.json again... it has uuid. Does it have nanoid?
// source code used nanoid. I'll stick to uuid as it is more standard in backend or just use uuidv4.
// Wait, source imports nanoid. I should check if likely to have nanoid.
// I'll use uuid for now to be safe as it's definitely in package.json.

export type Todo = {
  slug: string;
  description: string;
  isCompleted: boolean;
};
export const getTodoListTools = ({ context }: { context: ToolContext }) => {
  const uniqueId = uuidv4();
  const todos: Todo[] = [];
  const getTodoListTool = tool({
    description: "Get the todo list",
    inputSchema: z.object({}),
    execute: async () => {
      return todos;
    },
  });

  const updateTodoListTool = tool({
    description: "Update the todo list, use this to add or update todos",
    inputSchema: z.object({
      updates: z.array(
        z.object({
          slug: z.string(),
          description: z.string().optional(),
          isCompleted: z.boolean(),
        }),
      ),
    }),
    execute: async ({ updates }) => {
      // Update existing todos if any and add new ones
      for (const updateItem of updates) {
        const existingTodo = todos.find((t) => t.slug === updateItem.slug);
        if (existingTodo) {
          existingTodo.isCompleted = updateItem.isCompleted;
        } else {
          todos.push({
            slug: updateItem.slug,
            description: updateItem.description ?? "",
            isCompleted: updateItem.isCompleted,
          });
        }
      }
      // Update the todo list with writer
      context.writer?.write({
        type: "data-todos",
        id: uniqueId,
        data: {
          id: uniqueId,
          todos: todos,
        },
      });
      return "Todo list updated";
    },
  });

  return {
    getTodoListTool,
    updateTodoListTool,
  };
};

// {
//     "input_tokens": 350,
//     "output_tokens": 240,
//     "total_tokens": 590,
//     "input_token_details": {
//         "audio": 10,
//         "cache_creation": 200,
//         "cache_read": 100,
//     },
//     "output_token_details": {
//         "audio": 10,
//         "reasoning": 200,
//     }
// }

type _CallbackTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details: Record<string, number>;
  output_token_details: Record<string, number>;
};

export type CallbackTokenUsage = Record<string, _CallbackTokenUsage>;

type _TokenUsageSingle = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails: Record<string, number>;
  outputTokenDetails: Record<string, number>;
};

export type TokenUsage = Record<string, _TokenUsageSingle>;

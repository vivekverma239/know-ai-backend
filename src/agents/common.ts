export const COMMON_CITATION_PROMPT = `
## Citation Format
- You must use inline citations to support all the relevant information and claims you make.
- You must use the following format for inline citations:
  Format: [fileID/page=pageNumber,pageNumber]
  For Example:
  This segment reported €3.4 billion in sales and a 17.3% operating margin in FY2022, with most brands surpassing pre-pandemic levels [file_8320377c-f09e-4739-8d4e-9726fbae32de/page=1,2] [file_8320377c-f09e-4739-8d4e-9726fbae32de/page=5].
- Each citation bracket should contain one fileID with one or more page numbers from that file (e.g., page=1,2,5).
- Multiple citations from different files should use separate brackets (as shown in the example above).
`;

import { ServerError, ServerErrorCodes } from "@venloc/typemo";
const searchBySense = async (text: string, limit: number): Promise<{ title: string }[]> => [];
const searchByWords = async (text: string, limit: number): Promise<{ title: string }[]> => [];
// ---cut---
export const search = async (text: string, limit = 10): Promise<{ title: string }[]> => {
  try {
    return await searchBySense(text, limit);
  } catch (error) {
    if (error instanceof ServerError && error.code === ServerErrorCodes.SearchNotEnabled) return searchByWords(text, limit);
    throw error;
  }
};

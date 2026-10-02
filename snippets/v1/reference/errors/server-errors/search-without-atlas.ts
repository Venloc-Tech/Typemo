import { ServerError, ServerErrorCodes } from "@venloc/typemo";
const searchBySense = async (text: string): Promise<{ title: string }[]> => [];
const searchByWords = async (text: string): Promise<{ title: string }[]> => [];
// ---cut---
export const search = async (text: string): Promise<{ title: string }[]> => {
  try {
    return await searchBySense(text);
  } catch (error) {
    if (error instanceof ServerError && error.code === ServerErrorCodes.SearchNotEnabled) return searchByWords(text);
    throw error;
  }
};

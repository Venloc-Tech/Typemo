class __BadRequest__ extends Error {}
// ---cut---
const cleanQuery = (text: string): string => {
  const query = text.trim();
  if (query === "" || query.length > 200) throw new __BadRequest__("the query must have 1 to 200 characters");
  return query;
};

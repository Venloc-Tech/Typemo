import { type WindowSpec } from "@venloc/typemo";

const running: WindowSpec = { documents: ["unbounded", "current"] };
const lastWeek: WindowSpec = { range: [-7, "current"], unit: "day" };

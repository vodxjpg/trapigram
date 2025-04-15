// /home/zodx/Desktop/trapigram/src/lib/dompurify.ts
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const purify = DOMPurify(window);

export default purify;
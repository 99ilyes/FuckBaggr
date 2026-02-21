import { JSDOM } from "jsdom";
import * as fs from "fs";
const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const dom = new JSDOM(html);
const doc = dom.window.document;

Array.from(doc.querySelectorAll("table")).forEach((t, i) => {
    let prev = t.previousElementSibling;
    let title = "";

    // Sometimes the heading is inside a parent container that precedes the table's container
    // Let's just find the closest previous text node or header tag
    // A more robust way is to iterate backwards through all elements in the body
    // But since JS DOM has treewalker, we can just look up.

    // Simple heuristic: walk previous elements
    while (prev) {
        if (prev.textContent && prev.textContent.trim().length > 0) {
            title = prev.textContent.trim().split("\n")[0];
            break;
        }
        prev = prev.previousElementSibling;
    }

    // If we didn't find anything, try parent's previous sibling
    if (!title && t.parentElement) {
        let pPrev = t.parentElement.previousElementSibling;
        while (pPrev) {
            if (pPrev.textContent && pPrev.textContent.trim().length > 0) {
                title = pPrev.textContent.trim().split("\n")[0];
                break;
            }
            pPrev = pPrev.previousElementSibling;
        }
    }

    const rows = Array.from(t.querySelectorAll("tr"));
    if (rows.length > 0) {
        const headers = Array.from(rows[0].querySelectorAll("th, td")).map(c => c.textContent?.trim());
        console.log(`Table ${i}, Preceding Text: '${title.substring(0, 50)}', Headers: ${headers.slice(0, 4)}`);
    }
});

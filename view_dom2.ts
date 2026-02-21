import { JSDOM } from "jsdom";
import * as fs from "fs";
const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const dom = new JSDOM(html);
const doc = dom.window.document;

function getPreviousText(element: Element | null): string {
    let curr: Node | null = element;
    while (curr) {
        if (curr.previousSibling) {
            curr = curr.previousSibling;
            while (curr.lastChild) {
                curr = curr.lastChild;
            }
            if (curr.nodeType === 3 && curr.textContent && curr.textContent.trim().length > 0) {
                return curr.textContent.trim();
            } else if (curr.textContent && curr.textContent.trim().length > 0) {
                // if it's an element, return its text content
                return curr.textContent.trim().split("\n").pop() || "";
            }
        } else {
            curr = curr.parentNode;
        }
    }
    return "";
}

Array.from(doc.querySelectorAll("table")).forEach((t, i) => {
    let title = getPreviousText(t);
    const rows = Array.from(t.querySelectorAll("tr"));
    if (rows.length > 0) {
        const headers = Array.from(rows[0].querySelectorAll("th, td")).map(c => c.textContent?.trim());
        console.log(`Table ${i}, PrevText: '${title.substring(0, 50)}', Headers: ${headers.slice(0, 3)}`);
    }
});

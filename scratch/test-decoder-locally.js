const fs = require('fs');

function decodeKwikCustom(html) {
    if (!html) return null;
    try {
        console.log("Starting decode...");
        // 1. Extract the dictionary array
        const dictMatch = html.match(/var\s+(_0x[a-f0-9]+)\s*=\s*(\[.+?\]);/s);
        if (!dictMatch) {
            console.log("No dictionary match");
            return null;
        }
        console.log("Dictionary Var Name:", dictMatch[1]);
        
        let dictStr = dictMatch[2].trim();
        if (dictStr.includes("'")) dictStr = dictStr.replace(/'/g, '"').replace(/,\]/, ']');
        const dictionary = JSON.parse(dictStr);
        console.log("Dictionary Size:", dictionary.length);

        // 2. Extract the eval call arguments
        const evalMatch = html.match(/\}\s*\(\s*("[^"]+",\s*\d+,\s*"[^"]+",\s*\d+,\s*\d+,\s*\d+)\s*\)\s*\)/s);
        if (!evalMatch) {
            console.log("No eval/args match");
            // Try fallback eval regex
            const fallbackMatch = html.match(/eval\(function\(.+?\}\((.+?)\)\)/s);
            if (fallbackMatch) console.log("Fallback match found but might be wrong:", fallbackMatch[1].substring(0, 50));
            return null;
        }

        const argsStr = evalMatch[1];
        console.log("Args String found:", argsStr.substring(0, 100) + "...");
        const args = [];
        let currentArg = '';
        let inQuotes = false;
        for (let i = 0; i < argsStr.length; i++) {
            const char = argsStr[i];
            if (char === '"' || char === "'") inQuotes = !inQuotes;
            if (char === ',' && !inQuotes) {
                args.push(currentArg.trim().replace(/^["']|["']$/g, ''));
                currentArg = '';
            } else {
                currentArg += char;
            }
        }
        args.push(currentArg.trim().replace(/^["']|["']$/g, ''));

        console.log("Args Count:", args.length);
        if (args.length < 6) return null;

        const Cu = args[0];
        const Gz = parseInt(args[1]);
        const BP = args[2];
        const KI = parseInt(args[3]);
        const Qv = parseInt(args[4]);

        const transform = (tn, zV, rL) => {
            const g = dictionary[2].split(dictionary[0]);
            const h = g.slice(0, zV);
            const i = g.slice(0, rL);
            const j = tn.split(dictionary[0]).reverse().reduce((xq, Uy, jj) => {
                if (h.indexOf(Uy) !== -1) return xq + h.indexOf(Uy) * (Math.pow(zV, jj));
                return xq;
            }, 0);
            let k = dictionary[0];
            let j_mut = j;
            while (j_mut > 0) {
                k = i[j_mut % rL] + k;
                j_mut = (j_mut - (j_mut % rL)) / rL;
            }
            return k || dictionary[11];
        };

        let decoded = "";
        for (let i = 0; i < Cu.length; i++) {
            let s = "";
            while (i < Cu.length && Cu[i] !== BP[Qv]) {
                s += Cu[i];
                i++;
            }
            for (let j = 0; j < BP.length; j++) {
                s = s.replace(new RegExp(BP[j], "g"), j);
            }
            decoded += String.fromCharCode(transform(s, Qv, 10) - KI);
        }

        const finalSource = decodeURIComponent(escape(decoded));
        console.log("Decoded Source Sample:", finalSource.substring(0, 200));
        const urlMatch = finalSource.match(/https?:\/\/[a-zA-Z0-9.-]+\.(?:nextcdn|kwcdn|kwikcdn)\.org\/[^"'\s\\]+/i);
        return urlMatch ? urlMatch[0] : null;
    } catch (e) {
        console.log("Error:", e.message);
        return null;
    }
}

const html = fs.readFileSync('scratch/zenrows_debug.html', 'utf8');
const result = decodeKwikCustom(html);
console.log("RESULT:", result);

const fs = require('fs');
const html = fs.readFileSync('scratch/zenrows_debug.html', 'utf8');

const scriptRegex = /<script.*?>([\s\S]*?)<\/script>/gi;
let match;
let i = 0;
while ((match = scriptRegex.exec(html))) {
    const content = match[1].trim();
    if (content.length > 0) {
        console.log(`Script ${i}: Length ${content.length}`);
        if (content.includes('eval')) {
            console.log(`  -> Contains eval`);
            if (content.includes('function(')) {
                console.log(`     -> Looks like a packer`);
            }
        }
        if (content.includes('.mp4')) {
            console.log(`  -> CONTAINS .mp4!`);
        }
        if (content.includes('kwcdn') || content.includes('nextcdn')) {
            console.log(`  -> CONTAINS CDN URL!`);
        }
    }
    i++;
}

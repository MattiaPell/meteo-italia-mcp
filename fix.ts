import * as fs from 'fs';

let content = fs.readFileSync('mcp/src/regioni/arpa-piemonte.ts', 'utf-8');

const target = `  cachedStations = rows.map(parseStation);
  cachedStationsTime = Date.now();
  return { ok: true, stations: cachedStations };`;

const replacement = `  cachedStations = rows.map(parseStation);
  cachedStationsTime = Date.now();
  return { ok: true, stations: cachedStations! };`;

content = content.replace(target, replacement);

fs.writeFileSync('mcp/src/regioni/arpa-piemonte.ts', content, 'utf-8');

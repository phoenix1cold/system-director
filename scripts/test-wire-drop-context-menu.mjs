import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../module/builder/formula-graph.mjs",import.meta.url),"utf8");
assert.match(source,/_ctxMenu\(sx,sy,gx,gy,conn=null\)/,"context menu must accept a pending connection");
assert.match(source,/this\._ctxMenu\(ev\.clientX,ev\.clientY,gx,gy,conn\)/,"dropping a wire on empty canvas must open the RMB context menu");
const endConn=source.slice(source.indexOf("  _endConn(ev) {"),source.indexOf("  _showQuickInsertMenu(conn, ev) {"));
assert.doesNotMatch(endConn,/_showQuickInsertMenu\(/,"wire drop must not open the legacy quick-insert menu");
assert.match(source,/if \(conn && !compatibleInput\(d\)\) return false;/,"wire context menu must filter incompatible nodes");
assert.match(source,/this\._addEdge\(conn\.fromNode,conn\.fromPin,added\.id,input\.id\)/,"created node must be connected to the dragged wire");
assert.match(source,/document\.querySelector\("\.sdgctx"\)\?\.remove\(\)/,"wire and RMB paths must share the sdgctx menu implementation");
console.log("Wire-drop RMB context menu regression: OK");

#!/bin/bash
# Demo Runner - 一键运行 Demo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "Multi-Agent Orchestration Demo"
echo "========================================"
echo ""

# 运行 demo-task.js 并捕获输出
OUTPUT=$(cd "$ROOT_DIR" && node demo/demo-task.js "$@")

# 检查是否包含有效的 JSON
if echo "$OUTPUT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.exit(d.taskId ? 0 : 1)" 2>/dev/null; then
    echo "✅ JSON 格式验证通过"
    echo ""
    echo "$OUTPUT" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('Task ID:', d.taskId);
console.log('模式:', d.mode);
console.log('执行模式:', d.plan?.executionMode || 'N/A');
console.log('Spawn Agents:', d.spawnInstructions?.length || 0);
if (d.spawnInstructions) {
  d.spawnInstructions.forEach((inst, i) => {
    console.log('  [' + (i+1) + ']', inst.title, '-', inst.label);
  });
}
"
    echo ""
    echo "========================================"
    echo "✅ Demo 运行成功"
    echo "========================================"
else
    echo "❌ JSON 格式验证失败"
    echo "$OUTPUT"
    exit 1
fi

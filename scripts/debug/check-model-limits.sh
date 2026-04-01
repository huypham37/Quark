#!/bin/bash
# Check context window limits for models from models.dev

MODELS=("gpt-5-mini" "claude-sonnet-4.5")

echo "Fetching models.dev/api.json..."
DATA=$(curl -s https://models.dev/api.json)

for model in "${MODELS[@]}"; do
  echo ""
  echo "=== $model ==="
  echo "$DATA" | bun -e "
    const data = JSON.parse(await Bun.stdin.text());
    const model = '$model';
    for (const [pid, p] of Object.entries(data)) {
      const m = p.models?.[model];
      if (m) {
        console.log('  provider:', pid);
        console.log('  limit:', JSON.stringify(m.limit, null, 2));
      }
    }
  "
done

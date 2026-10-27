/** Split CLI options into argv without shell expansion or execution. */
export function parseCliArguments(input: string): string[] {
  const args: string[] = [];
  let token = '';
  let started = false;
  let quote: string | undefined;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '\\' && quote !== "'") {
      const next = input[++index];
      if (next === undefined) throw new Error('Trailing escape in ALASS_EXTRA_ARGS');
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) token += '\\';
      if (next !== '\n') {
        token += next;
        started = true;
      }
    } else if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) args.push(token);
      token = '';
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed quote in ALASS_EXTRA_ARGS');
  if (started) args.push(token);
  return args;
}

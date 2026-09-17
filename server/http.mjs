export async function limitedText(response, max, requireOk = true) {
  if (requireOk && !response.ok) throw new Error(`Source unavailable (${response.status}).`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) throw new Error('Source exceeds size limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}


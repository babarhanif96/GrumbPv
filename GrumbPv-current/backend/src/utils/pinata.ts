import * as nodeBuffer from 'node:buffer';
import { PinataSDK } from 'pinata';
import dotenv from 'dotenv';

const NodeFile = 'File' in nodeBuffer ? nodeBuffer.File : undefined;
const NodeBlob = 'Blob' in nodeBuffer ? nodeBuffer.Blob : undefined;
if (typeof globalThis.File === 'undefined' && NodeFile) {
  globalThis.File = NodeFile as typeof globalThis.File;
}
if (typeof globalThis.Blob === 'undefined' && NodeBlob) {
  globalThis.Blob = NodeBlob;
}

dotenv.config();

export const pinata = new PinataSDK({
  pinataJwt: `${process.env.PINATA_JWT}`,
  pinataGateway: `${process.env.PINATA_GATEWAY_URL}`,
});

/** Multipart upload to Pinata public IPFS (avoids SDK code paths that reference global `File`). */
export async function uploadPublicFileToPinata(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ cid: string }> {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    throw new Error('PINATA_JWT is not configured');
  }

  const baseUrl = (process.env.PINATA_UPLOAD_URL || 'https://uploads.pinata.cloud/v3').replace(/\/$/, '');
  const BlobCtor = nodeBuffer.Blob;
  if (!BlobCtor) {
    throw new Error('Blob is not available in this Node runtime');
  }
  const blob = new BlobCtor([params.buffer], { type: params.mimeType });

  const form = new FormData();
  form.append('file', blob, params.filename);
  form.append('network', 'public');
  form.append('name', params.filename);

  const res = await fetch(`${baseUrl}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Source: 'sdk/file',
    },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pinata HTTP ${res.status}: ${text}`);
  }

  let parsed: { data?: { cid?: string } };
  try {
    parsed = JSON.parse(text) as { data?: { cid?: string } };
  } catch {
    throw new Error(`Pinata response was not JSON: ${text.slice(0, 240)}`);
  }

  const cid = parsed.data?.cid;
  if (!cid) {
    throw new Error('Pinata response missing data.cid');
  }

  return { cid };
}

/**
 * Chain writer — bridges the Book of Layers to Solana.
 *
 * Modes:
 *   mock   — nothing to send; the hash-chained local book is the record.
 *   solana — builds the real commit_act instruction via @palimpsest/chain-sdk.
 *            If RPC/keys are configured it sends the transaction; otherwise it
 *            returns the fully-encoded payload ("solana-prepared") so nothing
 *            is silently lost and operators can relay it later.
 *
 * No secrets in the repository: keys come from env at deploy time.
 */
import { config } from './config.js';

/** @returns {{ mode: string, commitAct: (artifact: object) => Promise<object> }} */
export async function createChainWriter(cfg = config) {
  if (cfg.chainMode !== 'solana') {
    return {
      mode: 'mock',
      async commitAct(artifact) {
        return { mode: 'mock', localSeq: artifact.bookSeq ?? null };
      },
    };
  }

  const sdk = await import('@palimpsest/chain-sdk/solana');
  const web3 = await import('@solana/web3.js');

  const rpcUrl = process.env.SOLANA_RPC_URL ?? '';
  const programId = process.env.SOLANA_PROGRAM_ID ?? '';
  const bookAccount = process.env.SOLANA_BOOK_ACCOUNT ?? '';
  const authorityJson = process.env.SOLANA_AUTHORITY_KEYPAIR ?? '';

  return {
    mode: 'solana',
    async commitAct(artifact) {
      if (!programId || !bookAccount) {
        return { mode: 'solana-unconfigured', error: 'set SOLANA_PROGRAM_ID and SOLANA_BOOK_ACCOUNT' };
      }
      const args = {
        artifactId: artifact.id,
        stateHashHex: artifact.stateHash,
        actionsMerkleHex: artifact.actionsMerkle,
        total: artifact.score.total,
        uri: artifact.provenanceCid ?? '',
      };
      const encoded = sdk.encodeCommitAct(args);
      const prepared = {
        mode: 'solana-prepared',
        programId,
        book: bookAccount,
        dataHex: Buffer.from(encoded).toString('hex'),
      };
      if (!rpcUrl || !authorityJson) return prepared;

      try {
        const authority = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(authorityJson)));
        const ix = sdk.buildCommitActInstruction({
          programId: new web3.PublicKey(programId),
          book: new web3.PublicKey(bookAccount),
          master: new web3.PublicKey(artifact.playerAddress ?? bookAccount),
          authority: authority.publicKey,
          ...args,
        });
        const connection = new web3.Connection(rpcUrl, 'confirmed');
        const tx = new web3.Transaction().add(ix);
        const signature = await web3.sendAndConfirmTransaction(connection, tx, [authority]);
        return { mode: 'solana', signature };
      } catch (err) {
        return { ...prepared, error: String(err?.message ?? err) };
      }
    },
  };
}

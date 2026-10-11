//! palimpsest_book — append-only provenance commitments (Книга Слоёв).
//!
//! On-chain we store only commitments: per-act merkle roots of the action
//! log, state hashes, and append-only notes. The full logs live off-chain
//! (Arweave/IPFS), referenced by `uri` — CONCEPT.md §7.2.
//!
//! This program is intentionally small and boring: it must be auditable in
//! one sitting. Runtime: Solana; framework: Anchor.
//!
//! License: Apache-2.0 (see repository NOTICE).

use anchor_lang::prelude::*;

declare_id!("BooK111111111111111111111111111111111111111");

pub const MAX_ARTIFACT_ID: usize = 64;
pub const MAX_URI: usize = 128;

#[program]
pub mod palimpsest_book {
    use super::*;

    /// Create the singleton book (platform authority).
    pub fn initialize_book(ctx: Context<InitializeBook>) -> Result<()> {
        let book = &mut ctx.accounts.book;
        book.authority = ctx.accounts.authority.key();
        book.head_hash = [0u8; 32];
        book.act_count = 0;
        Ok(())
    }

    /// Commit one finished restoration ("Акт реставрации").
    ///
    /// * `state_hash`      — sha256 of quantized final layers (server re-sim)
    /// * `actions_merkle`  — merkle root of the action log
    /// * `total`           — Индекс Палимпсеста, 0..=100
    /// * `uri`             — off-chain provenance passport (ar://, ipfs://)
    pub fn commit_act(
        ctx: Context<CommitAct>,
        artifact_id: String,
        state_hash: [u8; 32],
        actions_merkle: [u8; 32],
        total: u8,
        uri: String,
    ) -> Result<()> {
        require!(artifact_id.len() <= MAX_ARTIFACT_ID, BookError::ArtifactIdTooLong);
        require!(uri.len() <= MAX_URI, BookError::UriTooLong);
        require!(total <= 100, BookError::BadScore);

        let book = &mut ctx.accounts.book;
        let act = &mut ctx.accounts.act;

        act.seq = book.act_count;
        act.artifact_id = artifact_id;
        act.state_hash = state_hash;
        act.actions_merkle = actions_merkle;
        act.total = total;
        act.uri = uri;
        act.master = ctx.accounts.master.key();
        act.timestamp = Clock::get()?.unix_timestamp;

        // The book's head chains every act — a rewritten history is detectable.
        let mut preimage = Vec::with_capacity(128);
        preimage.extend_from_slice(&book.head_hash);
        preimage.extend_from_slice(&act.seq.to_le_bytes());
        preimage.extend_from_slice(&state_hash);
        preimage.extend_from_slice(&actions_merkle);
        preimage.extend_from_slice(&[total]);
        book.head_hash = anchor_lang::solana_program::hash::hash(&preimage).to_bytes();

        book.act_count += 1;
        Ok(())
    }

    /// Append a late note to an artifact (forensic verdict, restored provenance
    /// chain, exhibition award). Notes never rewrite — only add.
    pub fn append_note(
        ctx: Context<AppendNote>,
        artifact_id: String,
        note_hash: [u8; 32],
    ) -> Result<()> {
        require!(artifact_id.len() <= MAX_ARTIFACT_ID, BookError::ArtifactIdTooLong);
        let note = &mut ctx.accounts.note;
        note.seq = ctx.accounts.book.act_count; // monotonic gate
        note.artifact_id = artifact_id;
        note.note_hash = note_hash;
        note.author = ctx.accounts.author.key();
        note.timestamp = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Reputation ledger ("Аттестат") — one account per player wallet.
    /// The transferable/non-transferable Core NFT presentation is layered on
    /// top off-chain; here we keep the raw counters honest.
    pub fn init_attestation(ctx: Context<InitAttestation>) -> Result<()> {
        let att = &mut ctx.accounts.attestation;
        att.owner = ctx.accounts.owner.key();
        att.works = 0;
        att.score_sum = 0;
        att.best = 0;
        att.fakes_exposed = 0;
        Ok(())
    }

    pub fn record_work(ctx: Context<RecordWork>, total: u8) -> Result<()> {
        require!(total <= 100, BookError::BadScore);
        let att = &mut ctx.accounts.attestation;
        require!(att.owner == ctx.accounts.master.key(), BookError::NotOwner);
        att.works = att.works.saturating_add(1);
        att.score_sum = att.score_sum.saturating_add(total as u64);
        att.best = att.best.max(total);
        Ok(())
    }

    pub fn record_fake_exposed(ctx: Context<RecordWork>) -> Result<()> {
        let att = &mut ctx.accounts.attestation;
        require!(att.owner == ctx.accounts.master.key(), BookError::NotOwner);
        att.fakes_exposed = att.fakes_exposed.saturating_add(1);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeBook<'info> {
    #[account(init, payer = authority, space = Book::SPACE)]
    pub book: Account<'info, Book>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(artifact_id: String)]
pub struct CommitAct<'info> {
    #[account(mut, has_one = authority @ BookError::NotAuthority)]
    pub book: Account<'info, Book>,
    #[account(
        init,
        payer = authority,
        space = Act::SPACE,
        seeds = [b"act", book.key().as_ref(), artifact_id.as_bytes()],
        bump,
    )]
    pub act: Account<'info, Act>,
    /// CHECK: any master may commit; the platform authority pays.
    pub master: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(artifact_id: String)]
pub struct AppendNote<'info> {
    #[account(mut)]
    pub book: Account<'info, Book>,
    #[account(
        init,
        payer = author,
        space = Note::SPACE,
        seeds = [b"note", artifact_id.as_bytes(), &book.act_count.to_le_bytes()],
        bump,
    )]
    pub note: Account<'info, Note>,
    #[account(mut)]
    pub author: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitAttestation<'info> {
    #[account(init, payer = owner, space = Attestation::SPACE, seeds = [b"attestation", owner.key().as_ref()], bump)]
    pub attestation: Account<'info, Attestation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordWork<'info> {
    #[account(mut, seeds = [b"attestation", master.key().as_ref()], bump)]
    pub attestation: Account<'info, Attestation>,
    pub master: Signer<'info>,
}

#[account]
pub struct Book {
    pub authority: Pubkey,
    pub head_hash: [u8; 32],
    pub act_count: u64,
}
impl Book {
    pub const SPACE: usize = 8 + 32 + 32 + 8;
}

#[account]
pub struct Act {
    pub seq: u64,
    pub master: Pubkey,
    pub state_hash: [u8; 32],
    pub actions_merkle: [u8; 32],
    pub total: u8,
    pub timestamp: i64,
    pub artifact_id: String,
    pub uri: String,
}
impl Act {
    pub const SPACE: usize = 8 + 8 + 32 + 32 + 32 + 1 + 8 + (4 + MAX_ARTIFACT_ID) + (4 + MAX_URI);
}

#[account]
pub struct Note {
    pub seq: u64,
    pub author: Pubkey,
    pub note_hash: [u8; 32],
    pub timestamp: i64,
    pub artifact_id: String,
}
impl Note {
    pub const SPACE: usize = 8 + 8 + 32 + 32 + 8 + (4 + MAX_ARTIFACT_ID);
}

#[account]
pub struct Attestation {
    pub owner: Pubkey,
    pub works: u64,
    pub score_sum: u64,
    pub best: u8,
    pub fakes_exposed: u64,
}
impl Attestation {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 1 + 8;
}

#[error_code]
pub enum BookError {
    #[msg("artifact_id too long")]
    ArtifactIdTooLong,
    #[msg("uri too long")]
    UriTooLong,
    #[msg("score must be 0..=100")]
    BadScore,
    #[msg("not the book authority")]
    NotAuthority,
    #[msg("not the attestation owner")]
    NotOwner,
}

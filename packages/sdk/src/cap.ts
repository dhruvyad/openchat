// UCAN-style capabilities for openroom.
//
// A Cap is a signed delegation from an `iss` (issuer) to an `aud` (audience)
// granting a specific action on a specific resource, bounded by a validity
// window. Caps chain: the root is self-issued by a topic's declared authority,
// and each subsequent cap is narrower-or-equal to its parent.
//
// A leaf cap carries the full chain of ancestors inline in `proof`, which lets
// verifiers walk from leaf back to root without any external storage. Each
// ancestor in the proof is independently signed and independently verifiable;
// the ancestor's own `proof` field is stripped when embedded in a child's
// chain, because signatures are computed over the cap with `proof` excluded.

import { canonicalize } from './jcs.js';
import {
    fromBase64Url,
    randomNonce,
    sign,
    toBase64Url,
    verify,
} from './crypto.js';

const encoder = new TextEncoder();

export interface CapScope {
    /** e.g. `room:<name>/topic:<name>` or `room:<name>/*` */
    resource: string;
    /** e.g. `post`, `subscribe`, `write`, or `*` for any action */
    action: string;
    /** reserved for action-specific refinements; must be equal across a chain for v1 */
    constraints?: Record<string, unknown>;
}

export interface Cap {
    iss: string;
    aud: string;
    cap: CapScope;
    nbf: number;
    exp: number;
    nonce: string;
    /** parent chain, ROOT-FIRST. Leaf carries the full chain; intermediates
     * stored in `proof` have their own `proof` stripped. */
    proof?: Cap[];
    sig: string;
}

export interface MakeCapOptions {
    /** unix seconds, default: now */
    nbf?: number;
    /** unix seconds, default: now + 24h */
    exp?: number;
    nonce?: string;
}

const DEFAULT_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * Sign a cap. Canonicalization excludes both `sig` (because it's what we're
 * computing) and `proof` (because each cap in a chain is signed independently,
 * and its own proof is not part of its identity).
 */
export function signCap(
    unsigned: Omit<Cap, 'sig'>,
    privateKey: Uint8Array
): Cap {
    const { proof: _proof, ...rest } = unsigned;
    const canonical = canonicalize(rest);
    const signature = sign(encoder.encode(canonical), privateKey);
    return { ...unsigned, sig: toBase64Url(signature) };
}

/** Verify a single cap's signature against its `iss`. Does NOT walk the chain. */
export function verifyCap(c: Cap): boolean {
    const { sig, proof: _proof, ...rest } = c;
    const canonical = canonicalize(rest);
    try {
        const sigBytes = fromBase64Url(sig);
        const issBytes = fromBase64Url(c.iss);
        return verify(sigBytes, encoder.encode(canonical), issBytes);
    } catch {
        return false;
    }
}

/**
 * Create a root cap: self-issued by the calling keypair. The resulting cap has
 * `iss === aud === <pubkey>` and no proof chain. Used by the root authority to
 * bootstrap any delegation tree.
 */
export function makeRootCap(
    publicKey: Uint8Array,
    privateKey: Uint8Array,
    scope: CapScope,
    options: MakeCapOptions = {}
): Cap {
    const now = Math.floor(Date.now() / 1000);
    const nbf = options.nbf ?? now;
    const exp = options.exp ?? nbf + DEFAULT_LIFETIME_SECONDS;
    const pubkey = toBase64Url(publicKey);
    return signCap(
        {
            iss: pubkey,
            aud: pubkey,
            cap: scope,
            nbf,
            exp,
            nonce: options.nonce ?? randomNonce(16),
        },
        privateKey
    );
}

/**
 * Delegate from a cap the caller already holds. The new cap's proof chain is
 * built automatically by extending `parent.proof` (the ancestors that
 * authorize `parent` itself) with `parent` stripped of its own proof. The
 * caller must hold the private key matching `parent.aud`.
 */
export function delegateCap(
    parent: Cap,
    audiencePubkey: string,
    narrowerScope: CapScope,
    issuerPrivateKey: Uint8Array,
    options: MakeCapOptions = {}
): Cap {
    const now = Math.floor(Date.now() / 1000);
    const nbf = Math.max(options.nbf ?? now, parent.nbf);
    const exp = Math.min(
        options.exp ?? nbf + DEFAULT_LIFETIME_SECONDS,
        parent.exp
    );

    const parentAncestors = parent.proof ?? [];
    const fullProof: Cap[] = [];
    for (const ancestor of parentAncestors) {
        fullProof.push(stripProof(ancestor));
    }
    fullProof.push(stripProof(parent));

    return signCap(
        {
            iss: parent.aud,
            aud: audiencePubkey,
            cap: narrowerScope,
            nbf,
            exp,
            nonce: options.nonce ?? randomNonce(16),
            proof: fullProof,
        },
        issuerPrivateKey
    );
}

function stripProof(c: Cap): Cap {
    const { proof: _proof, ...rest } = c;
    return rest as Cap;
}

export interface CapVerifyOptions {
    /** pubkey that must appear as `aud` on the leaf cap (typically the sender) */
    expectedAudience: string;
    /** pubkey of the topic's declared root authority */
    expectedRoot: string;
    /** resource string the action is being performed against */
    requiredResource: string;
    /** action string being performed, e.g. 'post' or 'subscribe' */
    requiredAction: string;
    /** unix seconds; defaults to Date.now() */
    now?: number;
}

export interface CapVerifyResult {
    ok: boolean;
    reason?: string;
}

/**
 * Walk a cap chain from leaf to root, checking each link for:
 * - valid signature
 * - validity at current time (nbf ≤ now ≤ exp)
 * - delegation continuity (child.iss === parent.aud)
 * - narrowing (child scope covered by parent scope; child validity ⊆ parent validity)
 * and finally that the root is self-issued by `expectedRoot`.
 */
export function verifyCapChain(
    leaf: Cap,
    opts: CapVerifyOptions
): CapVerifyResult {
    const now = opts.now ?? Math.floor(Date.now() / 1000);

    if (leaf.aud !== opts.expectedAudience) {
        return { ok: false, reason: 'leaf audience does not match sender' };
    }
    if (
        !capCovers(leaf.cap, opts.requiredResource, opts.requiredAction)
    ) {
        return {
            ok: false,
            reason: 'leaf scope does not cover requested action',
        };
    }
    if (!isValidAt(leaf, now)) {
        return { ok: false, reason: 'leaf not valid at current time' };
    }
    if (!verifyCap(leaf)) {
        return { ok: false, reason: 'leaf signature invalid' };
    }

    const chain = leaf.proof ?? [];
    let child: Cap = leaf;

    for (let i = chain.length - 1; i >= 0; i--) {
        const parent = chain[i]!;
        if (!verifyCap(parent)) {
            return {
                ok: false,
                reason: `cap at chain[${i}] has invalid signature`,
            };
        }
        if (!isValidAt(parent, now)) {
            return {
                ok: false,
                reason: `cap at chain[${i}] not valid at current time`,
            };
        }
        if (child.iss !== parent.aud) {
            return {
                ok: false,
                reason: `delegation break at chain[${i}]: child.iss does not match parent.aud`,
            };
        }
        if (
            !capCovers(parent.cap, child.cap.resource, child.cap.action)
        ) {
            return {
                ok: false,
                reason: `cap at chain[${i}] scope does not cover child`,
            };
        }
        if (parent.nbf > child.nbf) {
            return {
                ok: false,
                reason: `cap at chain[${i}] nbf is later than child's`,
            };
        }
        if (parent.exp < child.exp) {
            return {
                ok: false,
                reason: `cap at chain[${i}] exp is earlier than child's`,
            };
        }
        child = parent;
    }

    // `child` is now the root of the chain.
    if (child.iss !== opts.expectedRoot) {
        return {
            ok: false,
            reason: 'root cap iss does not match expected authority',
        };
    }
    if (child.iss !== child.aud) {
        return { ok: false, reason: 'root cap is not self-issued' };
    }

    return { ok: true };
}

/** Does `scope` authorize the given `(resource, action)` pair? */
export function capCovers(
    scope: CapScope,
    resource: string,
    action: string
): boolean {
    if (!resourceCovers(scope.resource, resource)) return false;
    if (scope.action !== action && scope.action !== '*') return false;
    return true;
}

function resourceCovers(authorized: string, requested: string): boolean {
    if (authorized === requested) return true;
    if (authorized.endsWith('/*')) {
        const prefix = authorized.slice(0, -1); // keep trailing slash
        return requested.startsWith(prefix);
    }
    return false;
}

function isValidAt(c: Cap, now: number): boolean {
    return now >= c.nbf && now <= c.exp;
}

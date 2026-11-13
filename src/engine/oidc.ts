import * as client from 'openid-client';
import type { OidcConfig } from './model.ts';

// OpenID Connect (authorization code + PKCE + state + nonce) against the organisation's own IdP
// (Microsoft Entra ID, Google Workspace, Keycloak, ...). The client secret is read from the
// environment variable named in the spec, never stored in the spec or the database.

export class OidcSetupError extends Error {}

const configs = new Map<string, Promise<client.Configuration>>();

export function oidcConfiguration(o: OidcConfig, allowInsecure: boolean): Promise<client.Configuration> {
   const secret = process.env[o.clientSecretEnv];
   if (!secret) return Promise.reject(new OidcSetupError(`Environment variable ${o.clientSecretEnv} (client secret) belum diisi.`));
   const key = `${o.issuer}|${o.clientId}|${secret.length}`;
   let p = configs.get(key);
   if (!p) {
      const insecure = allowInsecure && o.issuer.startsWith('http://');
      p = client.discovery(new URL(o.issuer), o.clientId, secret, undefined, {
         timeout: 10,
         execute: insecure ? [client.allowInsecureRequests] : [],
      });
      // a failed discovery (IdP down, wrong issuer) must not be cached
      p.catch(() => configs.delete(key));
      configs.set(key, p);
   }
   return p;
}

export interface OidcStart { url: string; state: string; nonce: string; verifier: string }

export async function startLogin(cfg: client.Configuration, o: OidcConfig, redirectUri: string): Promise<OidcStart> {
   const verifier = client.randomPKCECodeVerifier();
   const state = client.randomState();
   const nonce = client.randomNonce();
   const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: o.scopes,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
   });
   return { url: url.href, state, nonce, verifier };
}

export async function finishLogin(cfg: client.Configuration, currentUrl: URL,
                                  checks: { state: string; nonce: string; verifier: string }): Promise<Record<string, unknown>> {
   const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: checks.verifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
   });
   const claims = tokens.claims();
   if (!claims) throw new Error('IdP tidak mengirim ID token.');
   return claims as Record<string, unknown>;
}

export interface OidcIdentity { issuer: string; subject: string; username: string; email: string | null; groups: string[] | null }

/** Map ID-token claims to an app user; null + reason when the domain is not allowed. */
export function identityFrom(o: OidcConfig, claims: Record<string, unknown>): OidcIdentity | { rejected: string } {
   const str = (k: string) => (typeof claims[k] === 'string' ? (claims[k] as string) : null);
   const email = str('email');
   if (o.allowedDomains.length) {
      const domain = (email?.split('@')[1] ?? str('hd') ?? '').toLowerCase();
      if (!o.allowedDomains.includes(domain)) return { rejected: `Akun dari domain "${domain || '?'}" tidak diizinkan untuk aplikasi ini.` };
   }
   if (email && claims.email_verified === false) return { rejected: 'Alamat email akun ini belum terverifikasi di penyedia identitas.' };
   const username = (str(o.usernameClaim) ?? email ?? String(claims.sub)).toLowerCase();
   let groups: string[] | null = null;
   if (o.groupsClaim) {
      const g = claims[o.groupsClaim];
      groups = Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : typeof g === 'string' ? [g] : [];
   }
   return { issuer: String(claims.iss), subject: String(claims.sub), username, email, groups };
}

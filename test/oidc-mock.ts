import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// A tiny OpenID Provider for tests: discovery, JWKS, /authorize (auto-approves) and /token.
// It checks PKCE, the client secret and single use of codes, like a real IdP would.

export interface MockUser { sub: string; email?: string; preferred_username?: string; groups?: string[]; email_verified?: boolean }

export interface MockIdp {
   issuer: string;
   clientId: string;
   clientSecret: string;
   nextUser: MockUser;
   close: () => Promise<void>;
}

export async function startMockIdp(clientId = 'pandawapex-test', clientSecret = randomBytes(16).toString('hex')): Promise<MockIdp> {
   const { publicKey, privateKey } = await generateKeyPair('RS256');
   const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
   const codes = new Map<string, { challenge: string; nonce: string; redirectUri: string; user: MockUser }>();
   const idp: MockIdp = { issuer: '', clientId, clientSecret, nextUser: { sub: 'u1' }, close: async () => {} };

   const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url!, idp.issuer);
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname === '/.well-known/openid-configuration') {
         return json(200, {
            issuer: idp.issuer, authorization_endpoint: `${idp.issuer}/authorize`, token_endpoint: `${idp.issuer}/token`,
            jwks_uri: `${idp.issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
         });
      }
      if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
         const p = url.searchParams;
         if (p.get('client_id') !== clientId || p.get('code_challenge_method') !== 'S256' || !p.get('nonce')) return json(400, { error: 'invalid_request' });
         const code = randomBytes(12).toString('hex');
         codes.set(code, { challenge: p.get('code_challenge')!, nonce: p.get('nonce')!, redirectUri: p.get('redirect_uri')!, user: idp.nextUser });
         const back = new URL(p.get('redirect_uri')!);
         back.searchParams.set('code', code);
         back.searchParams.set('state', p.get('state')!);
         res.writeHead(302, { location: back.href });
         return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
         let raw = '';
         for await (const chunk of req) raw += chunk;
         const form = new URLSearchParams(raw);
         const basic = (req.headers.authorization ?? '').replace(/^Basic /, '');
         const [id, secret] = Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent);
         const okClient = (id === clientId && secret === clientSecret) || (form.get('client_id') === clientId && form.get('client_secret') === clientSecret);
         if (!okClient) return json(401, { error: 'invalid_client' });
         const entry = codes.get(form.get('code') ?? '');
         codes.delete(form.get('code') ?? '');                       // single use
         if (!entry) return json(400, { error: 'invalid_grant' });
         const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
         if (challenge !== entry.challenge || form.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant' });
         const idToken = await new SignJWT({ ...entry.user, nonce: entry.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
            .setIssuer(idp.issuer).setAudience(clientId).setSubject(entry.user.sub)
            .setIssuedAt().setExpirationTime('5m').sign(privateKey);
         return json(200, { access_token: randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      json(404, { error: 'not_found' });
   });
   await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
   idp.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
   idp.close = () => new Promise(r => server.close(() => r()));
   return idp;
}

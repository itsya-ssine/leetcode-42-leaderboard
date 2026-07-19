// 42 (Intra) OAuth2 integration. This is the *only* authentication method
// in the app — see https://api.intra.42.fr/apidoc/guides/getting_started
// for how to register an app and get these credentials.
const INTRA_CLIENT_ID = process.env.INTRA_CLIENT_ID;
const INTRA_CLIENT_SECRET = process.env.INTRA_CLIENT_SECRET;

if (!INTRA_CLIENT_ID || !INTRA_CLIENT_SECRET) {
  // Fail loudly rather than silently disabling login — same philosophy as
  // the JWT_SECRET check in auth.ts.
  throw new Error(
    "INTRA_CLIENT_ID and INTRA_CLIENT_SECRET environment variables are required. " +
      "Create an app at https://profile.intra.42.fr/oauth/applications and set them in your .env file."
  );
}

const AUTHORIZE_URL = "https://api.intra.42.fr/oauth/authorize";
const TOKEN_URL = "https://api.intra.42.fr/oauth/token";
const ME_URL = "https://api.intra.42.fr/v2/me";

export interface IntraProfile {
  intraId: string; // 42 login, e.g. "jdoe" — unique, used in profile URLs
  displayName: string;
  avatarUrl?: string;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: INTRA_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public",
    state
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// Thrown whenever the 42 API side of the handshake can't be completed —
// callers should treat this as "try the login again", not fabricate a session.
export class IntraAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntraAuthError";
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: INTRA_CLIENT_ID,
        client_secret: INTRA_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      })
    });
  } catch (err: any) {
    throw new IntraAuthError(`Couldn't reach 42's OAuth server: ${err.message}`);
  }

  if (!response.ok) {
    throw new IntraAuthError(`42 OAuth token exchange failed (status ${response.status}).`);
  }

  const data: any = await response.json();
  if (!data?.access_token) {
    throw new IntraAuthError("42 OAuth token exchange didn't return an access token.");
  }
  return data.access_token as string;
}

export async function fetchIntraProfile(accessToken: string): Promise<IntraProfile> {
  let response: Response;
  try {
    response = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (err: any) {
    throw new IntraAuthError(`Couldn't reach 42's API: ${err.message}`);
  }

  if (!response.ok) {
    throw new IntraAuthError(`Couldn't fetch your 42 profile (status ${response.status}).`);
  }

  const data: any = await response.json();
  const login = data?.login;
  if (!login || typeof login !== "string") {
    throw new IntraAuthError("42 profile response didn't include a login.");
  }

  return {
    intraId: login,
    displayName: (data?.displayname as string) || (data?.usual_full_name as string) || login,
    avatarUrl: (data?.image?.link as string) || (data?.image?.versions?.medium as string) || undefined
  };
}

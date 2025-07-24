/*───────────────────────────────────────────────────────────────
  src/app/api/organizations/route.ts
───────────────────────────────────────────────────────────────*/
import { NextRequest, NextResponse } from 'next/server';
import { verify as jwtVerify, JwtPayload } from 'jsonwebtoken';
import { pgPool as pool } from '@/lib/db';
import { auth } from '@/lib/auth';
import { loadKey } from '@/lib/readKey';

/*──────────────────── Config ────────────────────*/
const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? '';
const JWT_PUBLIC_KEY = loadKey(
  process.env.SERVICE_JWT_PUBLIC_KEY ??
  process.env.SERVICE_JWT_PUBLIC_KEY_PATH,
);

/* Utility: does the caller present a *valid* service-account credential? */
function isServiceAccount(req: NextRequest): boolean {
  /* Bearer <service token> preferred */
  const authz = req.headers.get('authorization') ?? '';
  if (authz.startsWith('Bearer ')) {
    try {
      const payload = jwtVerify(
        authz.slice(7),
        JWT_PUBLIC_KEY,
        { algorithms: ['RS256'] },
      ) as JwtPayload;
      return payload.sub === 'service-account';
    } catch {
      /* fall through → maybe legacy x-api-key */
    }
  }
  /* Legacys x-api-key */
  return req.headers.get('x-api-key') === SERVICE_API_KEY;
}

/*──────────────────── GET /api/organizations ────────────────────*/
export async function GET(req: NextRequest) {
  /*──────── 1) SERVICE-ACCOUNT: list *every* org ────────*/
  if (isServiceAccount(req)) {
    try {
      const { rows } = await pool.query(/* sql */ `
        SELECT
          o.id, o.name, o.slug, o.logo,
          o.countries, o.metadata, o."encryptedSecret",
          COUNT(m."userId") AS "memberCount"
        FROM organization o
        LEFT JOIN member m ON m."organizationId" = o.id
        GROUP BY
          o.id, o.name, o.slug, o.logo,
          o.countries, o.metadata, o."encryptedSecret"
      `);

      return NextResponse.json({
        organizations: rows.map(r => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          logo: r.logo,
          countries: r.countries,
          metadata: r.metadata,
          encryptedSecret: r.encryptedSecret,
          memberCount: Number(r.memberCount),
          userRole: null,
        })),
      });
    } catch (err) {
      console.error('[SERVICE GET /api/organizations]', err);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  }

  /*──────── 2) PERSONAL SESSION / API-KEY ────────*/
  /* Session cookie or personal API key (Better-Auth) is enough to
     identify the user; we *only* return orgs where they’re the owner. */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { rows } = await pool.query(
      /* sql */ `
      SELECT
        o.id, o.name, o.slug, o.logo,
        o.countries, o.metadata, o."encryptedSecret",
        m.role               AS "userRole",
        COUNT(m2."userId")   AS "memberCount"
      FROM organization o
      JOIN member  m  ON m."organizationId" = o.id
      LEFT JOIN member m2 ON m2."organizationId" = o.id
      WHERE m."userId" = $1
      GROUP BY
        o.id, o.name, o.slug, o.logo,
        o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [session.user.id],
    );

    return NextResponse.json({
      organizations: rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        logo: r.logo,
        countries: r.countries,
        metadata: r.metadata,
        encryptedSecret: r.encryptedSecret,
        memberCount: Number(r.memberCount),
        userRole: r.userRole,
      })),
    });
  } catch (err) {
    console.error('[GET /api/organizations]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

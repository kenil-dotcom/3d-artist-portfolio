/**
 * Admin bootstrap CLI.
 *
 * Creates or updates the single admin account used to log into the CMS.
 * Reads username + password from stdin (password masked with a star
 * trick when the terminal supports raw mode), hashes the password with
 * argon2id via `lib/auth/password.ts`, and upserts a row into
 * `admin_users` keyed on the username.
 *
 * Usage:
 *   npm run admin:create
 *
 * The script terminates the Prisma client cleanly on success or error
 * so the process exits.
 */

import * as readline from 'node:readline';

import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';

interface Credentials {
  readonly username: string;
  readonly password: string;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}

/**
 * Read a password from stdin without echoing keystrokes. Falls back to
 * a plain visible read if the terminal does not support raw mode (e.g.
 * piped stdin in CI).
 */
async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const stdout = process.stdout;

  if (typeof stdin.setRawMode !== 'function' || !stdin.isTTY) {
    return prompt(question);
  }

  return new Promise<string>((resolve) => {
    stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode?.(true);
    let buffer = '';

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        // Enter or carriage return — finish.
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(buffer);
          return;
        }
        // Ctrl-C — abort.
        if (ch === '\u0003') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdout.write('\n');
          process.exit(130);
        }
        // Backspace.
        if (ch === '\u007f' || ch === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        buffer += ch;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function readCredentials(): Promise<Credentials> {
  const username = (await prompt('Admin username: ')).trim();
  if (username.length === 0) {
    throw new Error('Username is required.');
  }
  if (username.length > 60) {
    throw new Error('Username must be at most 60 characters.');
  }

  const password = await promptHidden('Admin password: ');
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const confirm = await promptHidden('Confirm password: ');
  if (confirm !== password) {
    throw new Error('Passwords do not match.');
  }

  return { username, password };
}

async function main(): Promise<void> {
  const { username, password } = await readCredentials();
  const passwordHash = await hashPassword(password);

  // The schema still has a NOT NULL `totpSecret` column; we don't use TOTP
  // in the MVP but supply an empty placeholder so the upsert succeeds.
  await prisma.adminUser.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      totpSecret: '',
    },
    update: {
      passwordHash,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Admin created/updated for username: ${username}`);
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`admin-create failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

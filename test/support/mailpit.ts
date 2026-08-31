import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const MAILPIT_IMAGE = 'axllent/mailpit:v1.30';
const SMTP_PORT = 1025;
const HTTP_PORT = 8025;
const POLL_INTERVAL_MS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export interface MailpitMessage {
  readonly id: string;
  readonly to: readonly string[];
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface TestMailpit {
  readonly host: string;
  readonly smtpPort: number;
  waitForMessageTo(email: string): Promise<MailpitMessage>;
  waitForSubjectTo(email: string, subject: string): Promise<MailpitMessage>;
  subjectsTo(email: string): Promise<readonly string[]>;
  deleteAll(): Promise<void>;
  stop(): Promise<void>;
}

interface MailpitSummary {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

interface MailpitDetail {
  readonly ID: string;
  readonly From: { readonly Address: string };
  readonly To: readonly { readonly Address: string }[];
  readonly Subject: string;
  readonly Text: string;
  readonly HTML: string;
}

export async function startTestMailpit(): Promise<TestMailpit> {
  const container: StartedTestContainer = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(SMTP_PORT, HTTP_PORT)
    .withWaitStrategy(Wait.forHttp('/readyz', HTTP_PORT))
    .start();

  const apiBase = `http://${container.getHost()}:${String(container.getMappedPort(HTTP_PORT))}`;

  async function listMessages(): Promise<readonly MailpitSummary[]> {
    const response = await fetch(`${apiBase}/api/v1/messages?limit=200`);

    if (!response.ok) {
      throw new Error(`Mailpit list failed with ${String(response.status)}`);
    }

    const body = (await response.json()) as { readonly messages?: readonly MailpitSummary[] };

    return body.messages ?? [];
  }

  async function readMessage(id: string): Promise<MailpitMessage> {
    const response = await fetch(`${apiBase}/api/v1/message/${id}`);

    if (!response.ok) {
      throw new Error(`Mailpit read failed with ${String(response.status)}`);
    }

    const detail = (await response.json()) as MailpitDetail;

    return {
      id: detail.ID,
      from: detail.From.Address,
      to: detail.To.map((recipient) => recipient.Address),
      subject: detail.Subject,
      text: detail.Text,
      html: detail.HTML,
    };
  }

  return {
    host: container.getHost(),
    smtpPort: container.getMappedPort(SMTP_PORT),

    async waitForMessageTo(email: string): Promise<MailpitMessage> {
      const deadline = Date.now() + DEFAULT_WAIT_TIMEOUT_MS;

      for (;;) {
        const match = (await listMessages()).find((message) =>
          message.To.some((recipient) => recipient.Address === email),
        );

        if (match !== undefined) {
          return readMessage(match.ID);
        }

        if (Date.now() > deadline) {
          throw new Error(`Mailpit received no message for ${email} within the timeout`);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async waitForSubjectTo(email: string, subject: string): Promise<MailpitMessage> {
      const deadline = Date.now() + DEFAULT_WAIT_TIMEOUT_MS;

      for (;;) {
        const match = (await listMessages()).find(
          (message) =>
            message.Subject === subject &&
            message.To.some((recipient) => recipient.Address === email),
        );

        if (match !== undefined) {
          return readMessage(match.ID);
        }

        if (Date.now() > deadline) {
          throw new Error(`Mailpit received no "${subject}" for ${email} within the timeout`);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async subjectsTo(email: string): Promise<readonly string[]> {
      return (await listMessages())
        .filter((message) => message.To.some((recipient) => recipient.Address === email))
        .map((message) => message.Subject);
    },

    async deleteAll(): Promise<void> {
      const response = await fetch(`${apiBase}/api/v1/messages`, { method: 'DELETE' });

      if (!response.ok) {
        throw new Error(`Mailpit delete failed with ${String(response.status)}`);
      }
    },

    async stop(): Promise<void> {
      await container.stop();
    },
  };
}

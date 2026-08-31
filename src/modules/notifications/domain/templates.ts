export interface RenderedMessage {
  readonly subject: string;
  readonly text: string;
}

export function welcomeMessage(input: { email: string; frontendBaseUrl: string }): RenderedMessage {
  return {
    subject: 'Welcome',
    text: [`Welcome, ${input.email}.`, '', `Your account is ready: ${input.frontendBaseUrl}`].join(
      '\n',
    ),
  };
}

export function invitationMessage(input: {
  organizationName: string;
  url: string;
  expiresAt: Date;
}): RenderedMessage {
  return {
    subject: `You have been invited to ${input.organizationName}`,
    text: [
      `You have been invited to join ${input.organizationName}.`,
      '',
      input.url,
      '',
      `The invitation expires on ${input.expiresAt.toISOString()}.`,
      'If you were not expecting it, ignore this message.',
    ].join('\n'),
  };
}

export function verifyEmailMessage(input: { url: string }): RenderedMessage {
  return {
    subject: 'Confirm your email address',
    text: [
      'Confirm your email address to finish signing up:',
      '',
      input.url,
      '',
      'If you did not create an account, ignore this message.',
    ].join('\n'),
  };
}

export function resetPasswordMessage(input: { url: string }): RenderedMessage {
  return {
    subject: 'Reset your password',
    text: [
      'Use this link to choose a new password:',
      '',
      input.url,
      '',
      'The link expires shortly. If you did not ask for it, ignore this message.',
    ].join('\n'),
  };
}

export function deleteAccountMessage(input: { url: string }): RenderedMessage {
  return {
    subject: 'Confirm account deletion',
    text: [
      'Confirm that you want to delete your account:',
      '',
      input.url,
      '',
      'This cannot be undone. If you did not ask for it, ignore this message.',
    ].join('\n'),
  };
}

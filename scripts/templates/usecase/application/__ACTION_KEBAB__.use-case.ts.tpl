import { Injectable } from '@nestjs/common';

export interface __ACTION_PASCAL__Command {
  readonly callerId: string;
}

@Injectable()
export class __ACTION_PASCAL__UseCase {
  execute(command: __ACTION_PASCAL__Command): Promise<void> {
    return Promise.reject(
      new Error(
        `__ACTION_PASCAL__UseCase is not implemented; refusing the call from ${command.callerId}.`,
      ),
    );
  }
}

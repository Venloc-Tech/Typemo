export class __NotFound__ extends Error {}

export class __BadRequest__ extends Error {
  constructor(message: string, readonly issues?: unknown) {
    super(message);
  }
}

export class __Conflict__ extends Error {}

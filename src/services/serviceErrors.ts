// Shared error identities; no backend/native dependencies.
export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class UserError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export class RestaurantError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "RestaurantError";
  }
}

export class ReviewError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export class StorageError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class SavedError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "SavedError";
  }
}

export class FollowError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "FollowError";
  }
}

export class BlockError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "BlockError";
  }
}

export class ListError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ListError";
  }
}

export class PostError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostError";
  }
}

export class ReviewLikeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReviewLikeError";
  }
}

export class CommentError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "CommentError";
  }
}

export class PostLikeError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostLikeError";
  }
}

export class PostCommentError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PostCommentError";
  }
}

export class NotificationError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export class PushTokenError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PushTokenError";
  }
}

export class ReportError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

export class BugReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BugReportError";
  }
}

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimError";
  }
}

export class RestaurantMenuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestaurantMenuError";
  }
}

export class ResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseError";
  }
}

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

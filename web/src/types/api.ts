export type UserRole = "learner" | "admin";

export type User = {
  id: string;
  login_id: string;
  user_name: string;
  role: UserRole;
};

export type MeResponse = { user: User };

export type LoginResponse = {
  user: User;
  expires_at: string;
};

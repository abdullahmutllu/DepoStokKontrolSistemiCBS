import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { User } from "@/types";

const TOKEN_KEY = "depo.token";
const USER_KEY = "depo.user";

interface AuthState {
  token: string | null;
  user: User | null;
}

function loadInitial(): AuthState {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    return {
      token,
      user: userRaw ? (JSON.parse(userRaw) as User) : null,
    };
  } catch {
    return { token: null, user: null };
  }
}

const authSlice = createSlice({
  name: "auth",
  initialState: loadInitial,
  reducers: {
    loggedIn(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      localStorage.setItem(TOKEN_KEY, action.payload.token);
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload.user));
    },
    loggedOut(state) {
      state.token = null;
      state.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});

export const { loggedIn, loggedOut } = authSlice.actions;
export default authSlice.reducer;

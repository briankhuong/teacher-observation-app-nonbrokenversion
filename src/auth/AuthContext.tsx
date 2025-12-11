// src/auth/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

// ----------------------------
// Context types
// ----------------------------
interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithAzure: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ----------------------------
// Provider
// ----------------------------
export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Check active session immediately
    async function getInitialSession() {
      const { data } = await supabase.auth.getSession();
      const currentSession = data.session;

      // Check if the URL contains an OAuth hash (access_token)
      // If it does, Supabase is still processing the login redirect.
      const hasAuthHash = window.location.hash.includes("access_token");

      if (mounted) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        // CRITICAL FIX:
        // Only stop loading if we have a session OR if there is NO hash to parse.
        // If there IS a hash, we stay 'loading' and wait for onAuthStateChange below.
        if (currentSession || !hasAuthHash) {
          setLoading(false);
        }
      }
    }

    getInitialSession();

    // 2. Listen for auth changes (this catches the moment the hash is parsed)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) {
        setSession(newSession ?? null);
        setUser(newSession?.user ?? null);
        
        // Once this fires, the hash has been handled, so we can stop loading
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ----------------------------
  // Sign-in with Azure
  // ----------------------------
  const signInWithAzure = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        // IMPORTANT: Ensure http://localhost:5173 is in Supabase "Redirect URLs"
        redirectTo: window.location.origin,
        
        // Standard scopes for reading user profile/email
        scopes: "openid email profile offline_access User.Read Mail.Send",
      },
    });

    if (error) {
      console.error("[Auth] Azure sign-in error:", error);
      alert("Could not sign in. Please try again.");
      setLoading(false);
    }
  };

  // ----------------------------
  // Sign-out
  // ----------------------------
  const signOut = async () => {
    try {
      // Standard sign out
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err) {
      console.error("[Auth] SignOut error", err);
    } finally {
      // Always clear local state
      setSession(null);
      setUser(null);
      // Ensure we stop loading so the user sees the Login screen
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        signInWithAzure,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ----------------------------
// Hook
// ----------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
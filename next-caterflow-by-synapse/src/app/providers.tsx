'use client';

import { ChakraProvider } from '@chakra-ui/react';
import { ThemeProvider } from 'next-themes';
import themes from './theme/theme';
import { LoadingProvider } from '@/context/LoadingContext';
import { SidebarProvider } from '@/context/SidebarContext';
import { SessionProvider } from 'next-auth/react'; // Import the new provider

// next-themes' ThemeProvider is already hydration-safe by design (it sets
// the class via a blocking inline script before first paint, not a
// client-only mount) — that's the whole point of the library. It used to
// be loaded via next/dynamic with `ssr: false`, but since it wraps
// `{children}` (the entire rest of the app), that forced the server to
// render nothing but an empty placeholder for the whole page — every
// route, not just this provider — and the client then had to replace that
// placeholder with the real, fully-rendered app on mount. That guaranteed
// a React hydration mismatch (error #418) on every single page load.

interface ProvidersProps {
  children?: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    // SessionProvider must wrap the entire application
    <SessionProvider>
      <ChakraProvider theme={themes}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <LoadingProvider>
            <SidebarProvider>
              {children}
            </SidebarProvider>
          </LoadingProvider>
        </ThemeProvider>
      </ChakraProvider>
    </SessionProvider>
  );
}
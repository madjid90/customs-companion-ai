import { useState, useEffect } from "react";

/**
 * Returns the current visual viewport height, adjusting for mobile keyboard.
 * When the keyboard opens, this returns the reduced viewport height.
 * Falls back to window.innerHeight when visualViewport is not available.
 */
export function useKeyboardHeight() {
  const [viewportHeight, setViewportHeight] = useState(() =>
    window.visualViewport?.height ?? window.innerHeight
  );
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const newHeight = vv.height;
      setViewportHeight(newHeight);
      // Keyboard is considered "open" when viewport is significantly smaller than screen
      setIsKeyboardOpen(window.innerHeight - newHeight > 100);
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  return { viewportHeight, isKeyboardOpen };
}

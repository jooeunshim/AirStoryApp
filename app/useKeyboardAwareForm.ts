import { HeaderHeightContext } from "@react-navigation/elements";
import { useCallback, useContext, useRef } from "react";
import { NativeSyntheticEvent, Platform, ScrollView, TargetedEvent } from "react-native";

/** Gap left between the bottom of the focused field and the top of the keyboard. */
const FOCUS_MARGIN = 28;

/**
 * Shared plumbing for forms that must stay visible while the keyboard is up.
 *
 * Two pieces are needed, and neither is sufficient alone:
 *  - Room to scroll. On iOS KeyboardAvoidingView pads the form; on Android the window itself
 *    resizes (Expo defaults android.softwareKeyboardLayoutMode to "resize"), so adding a
 *    KeyboardAvoidingView behavior there would shrink the form twice. Hence behavior is
 *    iOS-only.
 *  - Actually moving the focused field into that space, which is what was missing: without it a
 *    field below the fold stays hidden behind the keyboard no matter how much padding exists.
 *
 * Usage: spread onto the ScrollView, and pass handleFocus to every TextInput's onFocus.
 */
export function useKeyboardAwareForm() {
  const scrollRef = useRef<ScrollView>(null);
  // Screens rendered under a visible header must offset by its height or iOS pads by the wrong
  // amount. Reading the context directly (rather than useHeaderHeight) returns undefined instead
  // of throwing when there is no header, e.g. the login screen with headerShown: false.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  /**
   * Scroll the focused input above the keyboard. Uses the focus event's native node handle so the
   * measurement is of the real input wherever it sits in the tree — offsets captured from onLayout
   * are relative to the input's own parent, which lands in the wrong place whenever fields are
   * nested inside a card or wrapper view.
   */
  const handleFocus = useCallback((e: NativeSyntheticEvent<TargetedEvent>) => {
    const node = e.target;
    if (node == null) return;
    const responder = scrollRef.current?.getScrollResponder?.();
    responder?.scrollResponderScrollNativeHandleToKeyboard?.(node, FOCUS_MARGIN, true);
  }, []);

  return {
    scrollRef,
    handleFocus,
    /** iOS only — on Android the window resizes instead, so avoid compensating twice. */
    behavior: Platform.OS === "ios" ? ("padding" as const) : undefined,
    keyboardVerticalOffset: headerHeight,
  };
}

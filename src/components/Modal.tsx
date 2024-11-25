import { Dialog } from "@kobalte/core";
import { BsX } from "solid-icons/bs";
import { JSX, createSignal, createEffect, onCleanup } from "solid-js";

export default function Modal(props: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Dialog.Root modal open={props.isOpen} onOpenChange={props.setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/20 animate-out fade-out data-[expanded]:animate-in data-[expanded]:fade-in" />
        <div class="fixed inset-0 z-[999999] flex items-center justify-center">
          <Dialog.Content class="z-50 transition-all duration-300 max-w-[calc(100vw-16px)] max-h-[80vh] my-auto overflow-hidden border border-bg3 rounded-md bg-bg1 shadow-md animate-out zoom-out ease-in data-[expanded]:animate-in data-[expanded]:zoom-in data-[expanded]:duration-300 data-[expanded]:ease-out">
            <div class="p-4 w-full h-full">
              <div class="transition-all duration-300 flex items-center justify-between mb-3">
                <Dialog.Title class="text-xl font-semibold">
                  {props.title}
                </Dialog.Title>
                <Dialog.CloseButton class="w-8 h-8 flex justify-center items-center rounded-full outline-none focus-visible:ring-2 ring-primary/80">
                  <BsX class="w-7 h-7" />
                </Dialog.CloseButton>
              </div>
              <div class="text-base max-h-[calc(100vh-50px)] overflow-y-auto">
                {props.children}
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

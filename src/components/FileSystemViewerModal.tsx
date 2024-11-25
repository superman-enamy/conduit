import { toaster } from "@kobalte/core";
import { createEffect, createSignal, For, Show } from "solid-js";
import Modal from "./Modal";
import {
  FaSolidChevronDown,
  FaSolidFile,
  FaSolidFileAudio,
  FaSolidFileImage,
  FaSolidFileLines,
  FaSolidFileVideo,
  FaSolidFolder,
  FaSolidTrash,
} from "solid-icons/fa";
import { dialog } from "~/stores/DialogContext";
import { toast } from "./Toast";
import { getAllFilesAndDirectories } from "~/utils/opfs-helpers";

export default function FileSystemViewer(props: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  const [fileSystem, setFileSystem] = createSignal({});

  createEffect(() => {
    getAllFilesAndDirectories().then(setFileSystem);
  });
  const handleDelete = async (
    parentDir: FileSystemDirectoryHandle,
    itemName: string
  ) => {
    try {
      await parentDir.removeEntry(itemName, { recursive: true });
      getAllFilesAndDirectories().then(setFileSystem);
      toast.success(`Removed ${itemName}.`);
    } catch (e) {
      console.error(e);
      toast.error(`Could not remove ${itemName}. ${(e as any).message}`);
    }
  };

  return (
    <Modal
      title="OPFS Explorer"
      isOpen={props.isOpen}
      setIsOpen={props.setIsOpen}
    >
      <div class="p-2 w-96 max-w-full mx-auto">
        <For each={Object.entries(fileSystem())}>
          {([name, item]) => (
            <FileSystemNode
              item={item}
              onDelete={(itemName) =>
                handleDelete((item as any).parentDir, itemName)
              }
            />
          )}
        </For>
      </div>
    </Modal>
  );
}

const FileSystemNode = (props: {
  item: any;
  onDelete: (item: string) => void;
}) => {
  const [isOpen, setIsOpen] = createSignal(false);

  const toggleOpen = () => setIsOpen(!isOpen());

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <FaSolidFileImage class="h-4 w-4" />;
    if (type.startsWith("audio/")) return <FaSolidFileAudio class="h-4 w-4" />;
    if (type.startsWith("video/")) return <FaSolidFileVideo class="h-4 w-4" />;
    if (type.startsWith("text/")) return <FaSolidFileLines class="h-4 w-4" />;
    if (type.startsWith("folder")) return <FaSolidFolder class="h-4 w-4" />;
    return <FaSolidFile class="h-4 w-4" />;
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    dialog.showDelete({
      title: "Delete File",
      message: `Are you sure you want to delete ${props.item.name}? <br> This action cannot be undone.`,
      onConfirm: () => props.onDelete(props.item.name),
    });
  };

  return (
    <div class="mb-2 w-[--webkit-fill-available]">
      <div
        classList={{
          "rounded-lg shadow-md p-4 cursor-pointer transition-all duration-300 ease-in-out bg-bg2":
            true,
          "hover:shadow-lg": props.item.kind === "directory",
          "ring-2 ring-primary/80": isOpen(),
        }}
        onClick={toggleOpen}
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <span class="text-2xl">
              {getFileIcon(props.item.type || "folder")}
            </span>
            <span
              classList={{
                "font-semibold": true,
                "text-primary": props.item.kind === "directory",
              }}
            >
              {props.item.name}
            </span>
          </div>
          <div class="flex items-center space-x-2">
            <Show when={props.item.kind === "directory"}>
              <span
                classList={{
                  "transform transition-transform duration-300": true,
                  "rotate-180": isOpen(),
                }}
              >
                <FaSolidChevronDown class="w-4 h-4" />
              </span>
            </Show>
            <button
              class="p-2 rounded focus-visible:ring-2 ring-red-500/80 outline-none text-red-500 hover:text-red-700"
              onClick={handleDelete}
            >
              <FaSolidTrash class="w-4 h-4" />
            </button>
          </div>
        </div>
        <Show when={props.item.kind === "file"}>
          <div class="mt-2 text-sm text-text2">
            {props.item.type || "unknown"} • {formatSize(props.item.size)}
          </div>
        </Show>
      </div>
      <Show when={props.item.kind === "directory" && isOpen()}>
        <div class="ml-6 mt-2 pl-4 border-l-2 border-primary/80">
          <For each={Object.entries(props.item.contents)}>
            {([name, item]) => (
              <FileSystemNode item={item} onDelete={props.onDelete} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

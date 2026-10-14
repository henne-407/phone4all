import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")


def main():
    from .app import App

    return App().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())

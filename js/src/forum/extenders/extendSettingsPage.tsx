import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import type Mithril from 'mithril';
import ItemList from 'flarum/common/utils/ItemList';
import SignatureSettings from '../components/SignatureSettings';

export default function extendSettingsPage() {
  // SettingsPage is a chunk module (lazy-loaded) in Flarum 2.x — must use
  // string-based extend instead of importing the prototype directly.
  extend('flarum/forum/components/SettingsPage', 'settingsItems', function (items: ItemList<Mithril.Children>) {
    const user = app.session.user;

    if (!user || !user.canEditSignature()) {
      return;
    }

    items.add('signature', <SignatureSettings />);
  });
}

import Extend from 'flarum/common/extenders';
import app from 'flarum/admin/app';

export default [
  new Extend.Admin()
    .setting(() => ({
      setting: 'signature.maximum_image_count',
      type: 'number',
      label: app.translator.trans('fof-signature.admin.settings.maximum_image_count.description'),
      help: app.translator.trans('fof-signature.admin.settings.maximum_image_count.help'),
    }))
    .setting(() => ({
      setting: 'signature.maximum_char_limit',
      type: 'number',
      label: app.translator.trans('fof-signature.admin.settings.maximum_char_limit.description'),
      help: app.translator.trans('fof-signature.admin.settings.maximum_char_limit.help'),
    }))
    .setting(() => ({
      setting: 'signature.allow_inline_editing',
      type: 'boolean',
      label: app.translator.trans('fof-signature.admin.settings.allow_inline_editing.description'),
      help: app.translator.trans('fof-signature.admin.settings.allow_inline_editing.help'),
    }))
    .permission(
      () => ({
        permission: 'moderateSignature',
        icon: 'fas fa-signature',
        label: app.translator.trans('fof-signature.admin.permissions.edit_signature_others'),
      }),
      'moderate'
    )
    .permission(
      () => ({
        permission: 'haveSignature',
        icon: 'fas fa-signature',
        label: app.translator.trans('fof-signature.admin.permissions.allow_signature'),
      }),
      'start'
    ),
];

<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature;

use Flarum\Api\Resource;
use Flarum\Extend;
use Flarum\User\Event\Saving as UserSaving;
use Flarum\User\User;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js')
        ->css(__DIR__.'/less/forum.less'),

    (new Extend\Frontend('admin'))
        ->js(__DIR__.'/js/dist/admin.js'),

    new Extend\Locales(__DIR__.'/locale'),

    (new Extend\ApiResource(Resource\UserResource::class))
        ->fields(Api\UserResourceFields::class),

    (new Extend\Event())
        ->listen(UserSaving::class, Listener\SaveSignatureToDatabase::class),

    (new Extend\Settings())
        ->default('signature.maximum_char_limit', 500)
        ->default('signature.maximum_image_count', 2)
        ->default('signature.allow_inline_editing', false)
        ->serializeToForum('allowInlineEditing', 'signature.allow_inline_editing', 'boolval'),

    (new Extend\Model(User::class))
        ->cast('signature', 'string'),

    (new Extend\Policy())
        ->modelPolicy(User::class, Access\UserPolicy::class),

    (new Extend\ServiceProvider())
        ->register(Provider\SignatureFormatterProvider::class),
];

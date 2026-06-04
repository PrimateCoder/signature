<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Access;

use Flarum\User\Access\AbstractPolicy;
use Flarum\User\User;

class UserPolicy extends AbstractPolicy
{
    public function editSignature(User $actor, User $user): ?string
    {
        if ($user->isAdmin() && !$actor->isAdmin()) {
            return $this->deny();
        }

        if (!$user->hasPermission('haveSignature')) {
            return $this->deny();
        }

        if ($actor->id === $user->id || $actor->hasPermission('moderateSignature')) {
            return $this->allow();
        }

        return null;
    }
}

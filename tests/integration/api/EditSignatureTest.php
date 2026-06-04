<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Tests\integration\api;

use Flarum\Testing\integration\RetrievesAuthorizedUsers;
use Flarum\Testing\integration\TestCase;
use Flarum\User\User;
use PHPUnit\Framework\Attributes\Test;

class EditSignatureTest extends TestCase
{
    use RetrievesAuthorizedUsers;

    public function setUp(): void
    {
        parent::setUp();

        $this->extension('fof-signature');

        $this->prepareDatabase([
            'users' => [
                $this->normalUser(),
                ['id' => 3, 'username' => 'normal2', 'password' => '$2y$10$LO59tiT7uggl6Oe23o/O6.utnF6ipngYjvMvaxo1TciKqBttDNKim', 'email' => 'normal2@machine.local', 'is_email_confirmed' => true, 'signature' => 'too-obscure'],
                ['id' => 4, 'username' => 'moderator', 'password' => '$2y$10$LO59tiT7uggl6Oe23o/O6.utnF6ipngYjvMvaxo1TciKqBttDNKim', 'email' => 'moderator@machine.local', 'is_email_confirmed' => true, 'signature' => 'mod-sig'],
                ['id' => 5, 'username' => 'normal3', 'password' => '$2y$10$LO59tiT7uggl6Oe23o/O6.utnF6ipngYjvMvaxo1TciKqBttDNKim', 'email' => 'normal3@machine.local', 'is_email_confirmed' => true, 'signature' => 'too-obscure3'],
                ['id' => 6, 'username' => 'admin2', 'password' => '$2y$10$LO59tiT7uggl6Oe23o/O6.utnF6ipngYjvMvaxo1TciKqBttDNKim', 'email' => 'admin2@machine.local', 'is_email_confirmed' => true, 'signature' => 'admin-sig'],
            ],
            'group_permission' => [
                ['permission' => 'haveSignature', 'group_id' => 5],
                ['permission' => 'haveSignature', 'group_id' => 4],
                ['permission' => 'moderateSignature', 'group_id' => 4],
            ],
            'groups' => [
                ['id' => 5, 'name_singular' => 'TestSig', 'name_plural' => 'TestSigs', 'color' => '#FF0000', 'icon' => 'fas fa-user'],
            ],
            'group_user' => [
                ['user_id' => 4, 'group_id' => 4],
                ['user_id' => 5, 'group_id' => 5],
                ['user_id' => 6, 'group_id' => 1],
            ],
        ]);
    }

    #[Test]
    public function user_can_edit_own_signature_when_allowed_to_have_one()
    {
        $response = $this->send(
            $this->request(
                'PATCH',
                '/api/users/5',
                [
                    'authenticatedAs' => 5,
                    'json'            => [
                        'data' => [
                            'attributes' => [
                                'signature' => 'This is my new signature',
                            ],
                        ],
                    ],
                ]
            )
        );

        $this->assertEquals(200, $response->getStatusCode(), 'User cannot edit own signature');

        $json = json_decode($response->getBody()->getContents(), true);

        $this->assertEquals('This is my new signature', $json['data']['attributes']['signature']);

        $user = User::find(5);

        $this->assertEquals('<t>This is my new signature</t>', $user->signature);
    }

    #[Test]
    public function moderator_cannot_edit_admin_signature()
    {
        $response = $this->send(
            $this->request(
                'PATCH',
                '/api/users/6',
                [
                    'authenticatedAs' => 4,
                    'json'            => [
                        'data' => [
                            'attributes' => [
                                'signature' => 'Tampered admin signature',
                            ],
                        ],
                    ],
                ]
            )
        );

        $this->assertEquals(403, $response->getStatusCode(), 'Moderator should not be able to edit admin signature');

        $user = User::find(6);

        $this->assertEquals('admin-sig', $user->signature);
    }

    #[Test]
    public function moderator_can_edit_regular_user_signature()
    {
        $response = $this->send(
            $this->request(
                'PATCH',
                '/api/users/5',
                [
                    'authenticatedAs' => 4,
                    'json'            => [
                        'data' => [
                            'attributes' => [
                                'signature' => 'Moderator set this',
                            ],
                        ],
                    ],
                ]
            )
        );

        $this->assertEquals(200, $response->getStatusCode(), 'Moderator should be able to edit regular user signature');

        $user = User::find(5);

        $this->assertEquals('<t>Moderator set this</t>', $user->signature);
    }
}
